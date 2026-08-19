//! `MealyDocument`: a `MealyDoc` paired with its own undo/redo history —
//! same "every mutation's inverse captured at apply time" shape as
//! `doc::Document`/`doc::EditOp` (design D4), but genuinely separate types,
//! not a generalization of them. `doc::History`/`doc::Tx` are hardcoded to
//! `doc::EditOp` (`pub type Tx = Vec<EditOp>`), so sharing them would mean
//! making the whole undo/redo layer generic over the op type — a change to
//! already-tested, working code that option (B) of the Mealy decision
//! (docs/decisions.md) specifically chose to avoid. The mechanism is
//! duplicated; nothing about `FaDoc` or its edit layer is touched.

use crate::ids::{StateId, SymbolId};
use crate::model::mealy::MealyDoc;
use std::collections::BTreeMap;

/// A single reversible Mealy edit — same shape/rules as `doc::EditOp`:
/// labels (not raw ids) for symbols, `apply` never panics on a structurally
/// invalid op (treats it as a no-op with an empty inverse), preconditions
/// are the caller's responsibility.
#[derive(Debug, Clone, PartialEq)]
pub enum MealyEditOp {
    AddState {
        label: String,
        x: f64,
        y: f64,
    },
    /// Inverse-only — see `doc::EditOp::RestoreState`'s doc comment; same
    /// D2 free-list LIFO discipline applies here unchanged (shared `Arena`).
    RestoreState {
        id: StateId,
        label: String,
        x: f64,
        y: f64,
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
    /// Replaces the full `(from, to)` transition set in one op — same
    /// "whole edge, not incremental" shape as `doc::EditOp::SetEdge`.
    SetTransitions {
        from: StateId,
        to: StateId,
        /// `(input, output)` pairs; an empty vec removes the edge.
        entries: Vec<(String, String)>,
    },
}

impl MealyEditOp {
    /// Apply this op to `doc`, returning the ops that undo it, in the
    /// order they must be applied to fully reverse this op.
    pub fn apply(self, doc: &mut MealyDoc) -> Vec<MealyEditOp> {
        match self {
            MealyEditOp::AddState { label, x, y } => match doc.add_state(&label, x, y) {
                Ok(id) => vec![MealyEditOp::RemoveState { id }],
                Err(_) => vec![],
            },
            MealyEditOp::RestoreState { id, label, x, y } => match doc.restore_state(id, &label, x, y) {
                Ok(()) => vec![MealyEditOp::RemoveState { id }],
                Err(_) => vec![],
            },
            MealyEditOp::RemoveState { id } => {
                if doc.state_meta(id).is_none() {
                    return vec![];
                }
                let label = doc.state_label(id).unwrap_or("").to_string();
                let meta = *doc.state_meta(id).unwrap();
                let was_initial = doc.initial_state() == Some(id);
                let incident: Vec<((StateId, StateId), BTreeMap<SymbolId, SymbolId>)> = doc
                    .edges()
                    .filter(|((from, to), _)| *from == id || *to == id)
                    .map(|(k, v)| (*k, v.clone()))
                    .collect();

                doc.remove_state(id);

                let mut inverse = vec![MealyEditOp::RestoreState { id, label, x: meta.x, y: meta.y }];
                for ((from, to), transitions) in incident {
                    let entries = transitions
                        .iter()
                        .filter_map(|(input, output)| {
                            let input_label = doc.input_symbol_label(*input)?;
                            let output_label = doc.output_symbol_label(*output)?;
                            Some((input_label.to_string(), output_label.to_string()))
                        })
                        .collect();
                    inverse.push(MealyEditOp::SetTransitions { from, to, entries });
                }
                if was_initial {
                    inverse.push(MealyEditOp::SetInitial { id: Some(id) });
                }
                inverse
            }
            MealyEditOp::MoveState { id, x, y } => match doc.state_meta(id).copied() {
                None => vec![],
                Some(prev) => {
                    doc.move_state(id, x, y);
                    vec![MealyEditOp::MoveState { id, x: prev.x, y: prev.y }]
                }
            },
            MealyEditOp::RenameState { id, label } => {
                let prev = match doc.state_label(id) {
                    Some(l) => l.to_string(),
                    None => return vec![],
                };
                match doc.rename_state(id, &label) {
                    Ok(()) => vec![MealyEditOp::RenameState { id, label: prev }],
                    Err(_) => vec![],
                }
            }
            MealyEditOp::SetInitial { id } => {
                let prev = doc.initial_state();
                doc.set_initial(id);
                vec![MealyEditOp::SetInitial { id: prev }]
            }
            MealyEditOp::SetTransitions { from, to, entries } => {
                let prev = doc.edge(from, to).cloned().unwrap_or_default();
                let prev_entries: Vec<(String, String)> = prev
                    .iter()
                    .filter_map(|(input, output)| {
                        let input_label = doc.input_symbol_label(*input)?;
                        let output_label = doc.output_symbol_label(*output)?;
                        Some((input_label.to_string(), output_label.to_string()))
                    })
                    .collect();

                let mut transitions = BTreeMap::new();
                for (input, output) in &entries {
                    let input_id = doc.intern_input_symbol(input);
                    let output_id = doc.intern_output_symbol(output);
                    transitions.insert(input_id, output_id);
                }
                doc.set_transitions(from, to, transitions);

                vec![MealyEditOp::SetTransitions { from, to, entries: prev_entries }]
            }
        }
    }
}

pub type MealyTx = Vec<MealyEditOp>;

/// Same shape as `doc::History` — see this module's doc comment for why
/// it's a separate type instead of a shared generic one.
#[derive(Debug, Clone, PartialEq)]
pub struct MealyHistory {
    pub done: Vec<MealyTx>,
    pub undone: Vec<MealyTx>,
    pub limit: usize,
}

impl MealyHistory {
    pub fn new(limit: usize) -> Self {
        MealyHistory { done: Vec::new(), undone: Vec::new(), limit }
    }

    pub fn record(&mut self, inverse_tx: MealyTx) {
        self.push_done(inverse_tx);
        self.undone.clear();
    }

    pub fn push_done(&mut self, tx: MealyTx) {
        self.done.push(tx);
        if self.done.len() > self.limit {
            self.done.remove(0);
        }
    }

    pub fn push_undone(&mut self, tx: MealyTx) {
        self.undone.push(tx);
        if self.undone.len() > self.limit {
            self.undone.remove(0);
        }
    }
}

/// A `MealyDoc` plus its undo/redo history and a monotonically increasing
/// revision counter — same shape as `doc::Document`.
#[derive(Debug, Clone, PartialEq)]
pub struct MealyDocument {
    pub model: MealyDoc,
    pub history: MealyHistory,
    pub revision: u64,
}

impl Default for MealyDocument {
    fn default() -> Self {
        Self::new()
    }
}

impl MealyDocument {
    pub fn new() -> Self {
        MealyDocument { model: MealyDoc::new(), history: MealyHistory::new(200), revision: 0 }
    }

    /// Apply a batch of ops as one undoable transaction.
    pub fn apply(&mut self, ops: Vec<MealyEditOp>) {
        let mut inverse = Vec::new();
        for op in ops {
            inverse.splice(0..0, op.apply(&mut self.model));
        }
        self.history.record(inverse);
        self.revision += 1;
    }

    /// Undo the most recent transaction. Returns `false` (no-op) if there is
    /// nothing to undo.
    pub fn undo(&mut self) -> bool {
        let Some(tx) = self.history.done.pop() else {
            return false;
        };
        let mut inverse = Vec::new();
        for op in tx {
            inverse.splice(0..0, op.apply(&mut self.model));
        }
        self.history.push_undone(inverse);
        self.revision += 1;
        true
    }

    /// Redo the most recently undone transaction. Returns `false` (no-op)
    /// if there is nothing to redo.
    pub fn redo(&mut self) -> bool {
        let Some(tx) = self.history.undone.pop() else {
            return false;
        };
        let mut inverse = Vec::new();
        for op in tx {
            inverse.splice(0..0, op.apply(&mut self.model));
        }
        self.history.push_done(inverse);
        self.revision += 1;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_add_state_is_undoable() {
        let mut doc = MealyDocument::new();
        doc.apply(vec![MealyEditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]);
        assert_eq!(doc.model.states().count(), 1);

        assert!(doc.undo());
        assert_eq!(doc.model.states().count(), 0);

        assert!(doc.redo());
        assert_eq!(doc.model.states().count(), 1);
    }

    #[test]
    fn removing_a_state_with_edges_restores_them_exactly_on_undo() {
        let mut doc = MealyDocument::new();
        doc.apply(vec![
            MealyEditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            MealyEditOp::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ]);
        let q0 = doc.model.states().next().unwrap();
        let q1 = doc.model.states().nth(1).unwrap();
        doc.apply(vec![
            MealyEditOp::SetInitial { id: Some(q0) },
            MealyEditOp::SetTransitions { from: q0, to: q1, entries: vec![("a".into(), "x".into())] },
        ]);

        doc.apply(vec![MealyEditOp::RemoveState { id: q0 }]);
        assert_eq!(doc.model.states().count(), 1);

        assert!(doc.undo());
        assert_eq!(doc.model.initial_state(), Some(q0));
        let entries: Vec<_> = doc
            .model
            .edge(q0, q1)
            .unwrap()
            .iter()
            .map(|(i, o)| (doc.model.input_symbol_label(*i).unwrap(), doc.model.output_symbol_label(*o).unwrap()))
            .collect();
        assert_eq!(entries, vec![("a", "x")]);
    }

    #[test]
    fn undo_on_an_empty_history_is_a_no_op() {
        let mut doc = MealyDocument::new();
        assert!(!doc.undo());
    }

    #[test]
    fn a_fresh_edit_clears_the_redo_stack() {
        let mut doc = MealyDocument::new();
        doc.apply(vec![MealyEditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]);
        doc.undo();
        doc.apply(vec![MealyEditOp::AddState { label: "q1".into(), x: 0.0, y: 0.0 }]);
        assert!(!doc.redo());
        assert_eq!(doc.model.states().count(), 1);
        assert_eq!(doc.model.state_label(doc.model.states().next().unwrap()), Some("q1"));
    }

    /// Applying a random sequence of edits then undoing each one must
    /// restore the document's observable content exactly at every step —
    /// same invariant, same synthesize-from-abstract-kinds shape, as
    /// `doc::history::tests::apply_then_undo_round_trip` (design D4).
    mod round_trip_undo_restores_every_step_exactly {
        use super::*;
        use proptest::prelude::*;

        #[derive(Debug, Clone)]
        enum OpKind {
            AddState,
            RemoveState,
            MoveState(f64, f64),
            RenameState(String),
            SetInitial,
            ClearInitial,
            SetTransition(String, String),
            RemoveEdge,
        }

        fn op_kind_strategy() -> impl Strategy<Value = OpKind> {
            prop_oneof![
                Just(OpKind::AddState),
                Just(OpKind::RemoveState),
                (-100.0..100.0f64, -100.0..100.0f64).prop_map(|(x, y)| OpKind::MoveState(x, y)),
                "[a-z][a-z0-9]{0,4}".prop_map(OpKind::RenameState),
                Just(OpKind::SetInitial),
                Just(OpKind::ClearInitial),
                ("[a-b]", "[x-y]").prop_map(|(i, o)| OpKind::SetTransition(i, o)),
                Just(OpKind::RemoveEdge),
            ]
        }

        fn synthesize(
            created: &mut Vec<StateId>,
            edges: &mut Vec<(StateId, StateId)>,
            next_label: &mut usize,
            kind: OpKind,
        ) -> Option<MealyEditOp> {
            match kind {
                OpKind::AddState => {
                    let label = format!("s{next_label}");
                    *next_label += 1;
                    Some(MealyEditOp::AddState { label, x: 0.0, y: 0.0 })
                }
                OpKind::RemoveState => {
                    if created.is_empty() {
                        return None;
                    }
                    let id = created.remove(0);
                    edges.retain(|(f, t)| *f != id && *t != id);
                    Some(MealyEditOp::RemoveState { id })
                }
                OpKind::MoveState(x, y) => {
                    let id = *created.first()?;
                    Some(MealyEditOp::MoveState { id, x, y })
                }
                OpKind::RenameState(label) => {
                    let id = *created.first()?;
                    Some(MealyEditOp::RenameState { id, label })
                }
                OpKind::SetInitial => {
                    let id = *created.first()?;
                    Some(MealyEditOp::SetInitial { id: Some(id) })
                }
                OpKind::ClearInitial => Some(MealyEditOp::SetInitial { id: None }),
                OpKind::SetTransition(input, output) => {
                    if created.len() < 2 {
                        return None;
                    }
                    let from = created[0];
                    let to = created[1 % created.len()];
                    edges.push((from, to));
                    Some(MealyEditOp::SetTransitions { from, to, entries: vec![(input, output)] })
                }
                OpKind::RemoveEdge => {
                    if edges.is_empty() {
                        return None;
                    }
                    let (from, to) = edges.remove(0);
                    Some(MealyEditOp::SetTransitions { from, to, entries: vec![] })
                }
            }
        }

        type Snapshot = (
            std::collections::BTreeSet<(String, u64, u64)>,
            Option<String>,
            std::collections::BTreeSet<(String, String, String, String)>,
        );

        fn snapshot(doc: &MealyDoc) -> Snapshot {
            let states = doc
                .states()
                .map(|id| {
                    let meta = doc.state_meta(id).unwrap();
                    (doc.state_label(id).unwrap().to_string(), meta.x.to_bits(), meta.y.to_bits())
                })
                .collect();
            let initial = doc.initial_state().map(|id| doc.state_label(id).unwrap().to_string());
            let edges = doc
                .edges()
                .flat_map(|((from, to), transitions)| {
                    let from_label = doc.state_label(*from).unwrap().to_string();
                    let to_label = doc.state_label(*to).unwrap().to_string();
                    transitions.iter().map(move |(input, output)| {
                        (
                            from_label.clone(),
                            to_label.clone(),
                            doc.input_symbol_label(*input).unwrap().to_string(),
                            doc.output_symbol_label(*output).unwrap().to_string(),
                        )
                    })
                })
                .collect();
            (states, initial, edges)
        }

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(256))]

            #[test]
            fn matches(kinds in prop::collection::vec(op_kind_strategy(), 0..24)) {
                let mut doc = MealyDocument::new();
                let mut created: Vec<StateId> = Vec::new();
                let mut edges: Vec<(StateId, StateId)> = Vec::new();
                let mut next_label = 0usize;
                let mut history_of_snapshots = vec![snapshot(&doc.model)];

                for kind in kinds {
                    if let Some(op) = synthesize(&mut created, &mut edges, &mut next_label, kind) {
                        doc.apply(vec![op]);
                        history_of_snapshots.push(snapshot(&doc.model));
                    }
                }

                let mut expected_idx = history_of_snapshots.len() - 1;
                prop_assert_eq!(snapshot(&doc.model), history_of_snapshots[expected_idx].clone());

                while expected_idx > 0 {
                    let undone = doc.undo();
                    prop_assert!(undone);
                    expected_idx -= 1;
                    prop_assert_eq!(snapshot(&doc.model), history_of_snapshots[expected_idx].clone());
                }
            }
        }
    }
}
