//! `Document`: an `FaDoc` paired with undo/redo history. Editing always
//! flows through `EditOp`s so every mutation's inverse can be captured at
//! apply time (design D4) — undo is O(edit size), not O(document).

pub mod history;

use crate::ids::{StateId, SymbolId};
use crate::model::fa::{FaDoc, SymbolSet};

pub use history::{History, Tx};

/// A single reversible edit. Carries labels (not raw ids) for symbols so ops
/// stay meaningful independent of interning order.
///
/// Preconditions are the caller's responsibility (mirroring the UI layer,
/// which validates before issuing ops — see spec "Invalid edit rejected").
/// `apply` never panics: structurally invalid ops (unknown id, rename
/// collision) are treated as no-ops and return an empty inverse.
#[derive(Debug, Clone, PartialEq)]
pub enum EditOp {
    AddState {
        label: String,
        x: f64,
        y: f64,
    },
    /// Inverse-only: reconstructs a previously-removed state at its exact
    /// original id (see design D4 / D2 free-list LIFO discipline).
    RestoreState {
        id: StateId,
        label: String,
        x: f64,
        y: f64,
        accepting: bool,
    },
    RemoveState {
        id: StateId,
    },
    MoveState {
        id: StateId,
        x: f64,
        y: f64,
    },
    RenameState {
        id: StateId,
        label: String,
    },
    SetInitial {
        id: Option<StateId>,
    },
    SetAccepting {
        id: StateId,
        accepting: bool,
    },
    SetEdge {
        from: StateId,
        to: StateId,
        epsilon: bool,
        symbols: Vec<String>,
    },
}

impl EditOp {
    /// Apply this op to `doc`, returning the sequence of ops that undo it
    /// (in the order they must be applied to fully reverse this op).
    pub fn apply(self, doc: &mut FaDoc) -> Vec<EditOp> {
        match self {
            EditOp::AddState { label, x, y } => match doc.add_state(&label, x, y) {
                Ok(id) => vec![EditOp::RemoveState { id }],
                Err(_) => vec![],
            },
            EditOp::RestoreState { id, label, x, y, accepting } => {
                match doc.restore_state(id, &label, x, y, accepting) {
                    Ok(()) => vec![EditOp::RemoveState { id }],
                    Err(_) => vec![],
                }
            }
            EditOp::RemoveState { id } => {
                if doc.state_meta(id).is_none() {
                    return vec![];
                }
                let label = doc.state_label(id).unwrap_or("").to_string();
                let meta = doc.state_meta(id).cloned().unwrap();
                let was_initial = doc.initial_state() == Some(id);
                let incident: Vec<((StateId, StateId), SymbolSet)> = doc
                    .edges()
                    .filter(|((from, to), _)| *from == id || *to == id)
                    .map(|(k, v)| (*k, v.clone()))
                    .collect();

                doc.remove_state(id);

                let mut inverse = vec![EditOp::RestoreState {
                    id,
                    label,
                    x: meta.x,
                    y: meta.y,
                    accepting: meta.accepting,
                }];
                for ((from, to), set) in incident {
                    let symbols = set
                        .symbols
                        .iter()
                        .filter_map(|s| doc.symbol_label(*s).map(|l| l.to_string()))
                        .collect();
                    inverse.push(EditOp::SetEdge {
                        from,
                        to,
                        epsilon: set.epsilon,
                        symbols,
                    });
                }
                if was_initial {
                    inverse.push(EditOp::SetInitial { id: Some(id) });
                }
                inverse
            }
            EditOp::MoveState { id, x, y } => match doc.state_meta(id).cloned() {
                None => vec![],
                Some(prev) => {
                    doc.move_state(id, x, y);
                    vec![EditOp::MoveState { id, x: prev.x, y: prev.y }]
                }
            },
            EditOp::RenameState { id, label } => {
                let prev = match doc.state_label(id) {
                    Some(l) => l.to_string(),
                    None => return vec![],
                };
                match doc.rename_state(id, &label) {
                    Ok(()) => vec![EditOp::RenameState { id, label: prev }],
                    Err(_) => vec![],
                }
            }
            EditOp::SetInitial { id } => {
                let prev = doc.initial_state();
                doc.set_initial(id);
                vec![EditOp::SetInitial { id: prev }]
            }
            EditOp::SetAccepting { id, accepting } => {
                if doc.state_meta(id).is_none() {
                    return vec![];
                }
                let prev = doc.is_accepting(id);
                doc.set_accepting(id, accepting);
                vec![EditOp::SetAccepting { id, accepting: prev }]
            }
            EditOp::SetEdge { from, to, epsilon, symbols } => {
                let prev = doc.edge(from, to).cloned().unwrap_or_default();
                let prev_symbols: Vec<String> = prev
                    .symbols
                    .iter()
                    .filter_map(|s| doc.symbol_label(*s).map(|l| l.to_string()))
                    .collect();
                let sym_ids: Vec<SymbolId> = symbols.iter().map(|s| doc.intern_symbol(s)).collect();
                let mut set = SymbolSet { epsilon, symbols: Default::default() };
                for id in sym_ids {
                    set.symbols.insert(id);
                }
                doc.set_edge(from, to, set);
                vec![EditOp::SetEdge {
                    from,
                    to,
                    epsilon: prev.epsilon,
                    symbols: prev_symbols,
                }]
            }
        }
    }
}

/// An `FaDoc` plus its undo/redo history and a monotonically increasing
/// revision counter (bumped on every successful `apply`/`undo`/`redo`).
#[derive(Debug, Clone, PartialEq)]
pub struct Document {
    pub model: FaDoc,
    pub history: History,
    pub revision: u64,
}

impl Default for Document {
    fn default() -> Self {
        Self::new()
    }
}

impl Document {
    pub fn new() -> Self {
        Document {
            model: FaDoc::new(),
            history: History::new(200),
            revision: 0,
        }
    }

    /// Apply a batch of ops as one undoable transaction.
    pub fn apply(&mut self, ops: Vec<EditOp>) {
        let mut per_op_inverses: Vec<Vec<EditOp>> = Vec::with_capacity(ops.len());
        for op in ops {
            per_op_inverses.push(op.apply(&mut self.model));
        }
        per_op_inverses.reverse();
        let inverse_tx: Tx = per_op_inverses.into_iter().flatten().collect();
        self.revision += 1;
        self.history.record(inverse_tx);
    }

    /// Undo the most recent transaction. Returns `false` if there was
    /// nothing to undo.
    pub fn undo(&mut self) -> bool {
        let Some(inverse_tx) = self.history.done.pop() else {
            return false;
        };
        let mut per_op_inverses: Vec<Vec<EditOp>> = Vec::with_capacity(inverse_tx.len());
        for op in inverse_tx {
            per_op_inverses.push(op.apply(&mut self.model));
        }
        per_op_inverses.reverse();
        let redo_tx: Tx = per_op_inverses.into_iter().flatten().collect();
        self.revision += 1;
        self.history.push_undone(redo_tx);
        true
    }

    /// Redo the most recently undone transaction. Returns `false` if there
    /// was nothing to redo.
    pub fn redo(&mut self) -> bool {
        let Some(redo_tx) = self.history.undone.pop() else {
            return false;
        };
        let mut per_op_inverses: Vec<Vec<EditOp>> = Vec::with_capacity(redo_tx.len());
        for op in redo_tx {
            per_op_inverses.push(op.apply(&mut self.model));
        }
        per_op_inverses.reverse();
        let inverse_tx: Tx = per_op_inverses.into_iter().flatten().collect();
        self.revision += 1;
        self.history.push_done(inverse_tx);
        true
    }
}
