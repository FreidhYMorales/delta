//! `MooreDocument`: a `MooreDoc` paired with its own undo/redo history —
//! same shape as `mealy_doc::MealyDocument`, genuinely separate types for
//! the same reason `mealy_doc.rs` gives (`doc::History`/`doc::Tx` are
//! hardcoded to `doc::EditOp`, so sharing would mean genericizing an
//! already-tested layer). The mechanism is duplicated a third time here;
//! nothing about `FaDoc`/`MealyDoc` or their edit layers is touched.

use crate::ids::{StateId, SymbolId};
use crate::model::moore::MooreDoc;
use std::collections::BTreeSet;

/// A single reversible Moore edit — same rules as `MealyEditOp`: labels
/// (not raw ids) for symbols, `apply` never panics on a structurally
/// invalid op (treats it as a no-op with an empty inverse), preconditions
/// are the caller's responsibility.
#[derive(Debug, Clone, PartialEq)]
pub enum MooreEditOp {
    AddState {
        label: String,
        x: f64,
        y: f64,
    },
    /// Inverse-only — see `doc::EditOp::RestoreState`'s doc comment; same
    /// D2 free-list LIFO discipline applies here unchanged (shared `Arena`).
    /// Restores geometry/label only; a prior non-empty output is restored
    /// by a follow-up `SetOutput` in the same inverse transaction (see
    /// `RemoveState`'s `apply` below).
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
    /// `None` clears the output back to unset.
    SetOutput {
        state: StateId,
        output: Option<String>,
    },
    /// Replaces the full input-symbol set of a `(from, to)` edge in one op
    /// — same "whole edge, not incremental" shape as
    /// `MealyEditOp::SetTransitions`, minus the per-symbol output pairing
    /// (Moore output lives on states, not edges).
    SetTransitions {
        from: StateId,
        to: StateId,
        /// Input labels; an empty vec removes the edge.
        inputs: Vec<String>,
    },
}

impl MooreEditOp {
    /// Apply this op to `doc`, returning the ops that undo it, in the
    /// order they must be applied to fully reverse this op.
    pub fn apply(self, doc: &mut MooreDoc) -> Vec<MooreEditOp> {
        match self {
            MooreEditOp::AddState { label, x, y } => match doc.add_state(&label, x, y) {
                Ok(id) => vec![MooreEditOp::RemoveState { id }],
                Err(_) => vec![],
            },
            MooreEditOp::RestoreState { id, label, x, y } => match doc.restore_state(id, &label, x, y) {
                Ok(()) => vec![MooreEditOp::RemoveState { id }],
                Err(_) => vec![],
            },
            MooreEditOp::RemoveState { id } => {
                if doc.state_meta(id).is_none() {
                    return vec![];
                }
                let label = doc.state_label(id).unwrap_or("").to_string();
                let meta = *doc.state_meta(id).unwrap();
                let was_initial = doc.initial_state() == Some(id);
                let incident: Vec<((StateId, StateId), BTreeSet<SymbolId>)> = doc
                    .edges()
                    .filter(|((from, to), _)| *from == id || *to == id)
                    .map(|(k, v)| (*k, v.clone()))
                    .collect();

                doc.remove_state(id);

                let mut inverse = vec![MooreEditOp::RestoreState { id, label, x: meta.x, y: meta.y }];
                if let Some(output_id) = meta.output {
                    let output_label = doc.output_symbol_label(output_id).map(str::to_string);
                    inverse.push(MooreEditOp::SetOutput { state: id, output: output_label });
                }
                for ((from, to), inputs) in incident {
                    let labels = inputs.iter().filter_map(|input| doc.input_symbol_label(*input)).map(str::to_string).collect();
                    inverse.push(MooreEditOp::SetTransitions { from, to, inputs: labels });
                }
                if was_initial {
                    inverse.push(MooreEditOp::SetInitial { id: Some(id) });
                }
                inverse
            }
            MooreEditOp::MoveState { id, x, y } => match doc.state_meta(id).copied() {
                None => vec![],
                Some(prev) => {
                    doc.move_state(id, x, y);
                    vec![MooreEditOp::MoveState { id, x: prev.x, y: prev.y }]
                }
            },
            MooreEditOp::RenameState { id, label } => {
                let prev = match doc.state_label(id) {
                    Some(l) => l.to_string(),
                    None => return vec![],
                };
                match doc.rename_state(id, &label) {
                    Ok(()) => vec![MooreEditOp::RenameState { id, label: prev }],
                    Err(_) => vec![],
                }
            }
            MooreEditOp::SetInitial { id } => {
                let prev = doc.initial_state();
                doc.set_initial(id);
                vec![MooreEditOp::SetInitial { id: prev }]
            }
            MooreEditOp::SetOutput { state, output } => {
                if doc.state_meta(state).is_none() {
                    return vec![];
                }
                let prev_label = doc.output(state).and_then(|id| doc.output_symbol_label(id)).map(str::to_string);
                let new_id = output.as_deref().map(|l| doc.intern_output_symbol(l));
                doc.set_output(state, new_id);
                vec![MooreEditOp::SetOutput { state, output: prev_label }]
            }
            MooreEditOp::SetTransitions { from, to, inputs } => {
                let prev = doc.edge(from, to).cloned().unwrap_or_default();
                let prev_inputs: Vec<String> =
                    prev.iter().filter_map(|input| doc.input_symbol_label(*input)).map(str::to_string).collect();

                let mut set = BTreeSet::new();
                for input in &inputs {
                    set.insert(doc.intern_input_symbol(input));
                }
                doc.set_transitions(from, to, set);

                vec![MooreEditOp::SetTransitions { from, to, inputs: prev_inputs }]
            }
        }
    }
}

pub type MooreTx = Vec<MooreEditOp>;

/// Same shape as `mealy_doc::MealyHistory` — see this module's doc comment
/// for why it's a separate type instead of a shared generic one.
#[derive(Debug, Clone, PartialEq)]
pub struct MooreHistory {
    pub done: Vec<MooreTx>,
    pub undone: Vec<MooreTx>,
    pub limit: usize,
}

impl MooreHistory {
    pub fn new(limit: usize) -> Self {
        MooreHistory { done: Vec::new(), undone: Vec::new(), limit }
    }

    pub fn record(&mut self, inverse_tx: MooreTx) {
        self.push_done(inverse_tx);
        self.undone.clear();
    }

    pub fn push_done(&mut self, tx: MooreTx) {
        self.done.push(tx);
        if self.done.len() > self.limit {
            self.done.remove(0);
        }
    }

    pub fn push_undone(&mut self, tx: MooreTx) {
        self.undone.push(tx);
        if self.undone.len() > self.limit {
            self.undone.remove(0);
        }
    }
}

/// A `MooreDoc` plus its undo/redo history and a monotonically increasing
/// revision counter — same shape as `mealy_doc::MealyDocument`.
#[derive(Debug, Clone, PartialEq)]
pub struct MooreDocument {
    pub model: MooreDoc,
    pub history: MooreHistory,
    pub revision: u64,
}

impl Default for MooreDocument {
    fn default() -> Self {
        Self::new()
    }
}

impl MooreDocument {
    pub fn new() -> Self {
        MooreDocument { model: MooreDoc::new(), history: MooreHistory::new(200), revision: 0 }
    }

    /// Apply a batch of ops as one undoable transaction.
    pub fn apply(&mut self, ops: Vec<MooreEditOp>) {
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
        let mut doc = MooreDocument::new();
        doc.apply(vec![MooreEditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]);
        assert_eq!(doc.model.states().count(), 1);

        assert!(doc.undo());
        assert_eq!(doc.model.states().count(), 0);

        assert!(doc.redo());
        assert_eq!(doc.model.states().count(), 1);
    }

    #[test]
    fn set_output_is_undoable() {
        let mut doc = MooreDocument::new();
        doc.apply(vec![MooreEditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]);
        let q0 = doc.model.states().next().unwrap();

        doc.apply(vec![MooreEditOp::SetOutput { state: q0, output: Some("even".into()) }]);
        assert_eq!(doc.model.output(q0).and_then(|id| doc.model.output_symbol_label(id)), Some("even"));

        assert!(doc.undo());
        assert_eq!(doc.model.output(q0), None);

        assert!(doc.redo());
        assert_eq!(doc.model.output(q0).and_then(|id| doc.model.output_symbol_label(id)), Some("even"));
    }

    #[test]
    fn removing_a_state_with_output_and_edges_restores_them_exactly_on_undo() {
        let mut doc = MooreDocument::new();
        doc.apply(vec![
            MooreEditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            MooreEditOp::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ]);
        let q0 = doc.model.states().next().unwrap();
        let q1 = doc.model.states().nth(1).unwrap();
        doc.apply(vec![
            MooreEditOp::SetInitial { id: Some(q0) },
            MooreEditOp::SetOutput { state: q0, output: Some("even".into()) },
            MooreEditOp::SetTransitions { from: q0, to: q1, inputs: vec!["a".into()] },
        ]);

        doc.apply(vec![MooreEditOp::RemoveState { id: q0 }]);
        assert_eq!(doc.model.states().count(), 1);

        assert!(doc.undo());
        assert_eq!(doc.model.initial_state(), Some(q0));
        assert_eq!(doc.model.output(q0).and_then(|id| doc.model.output_symbol_label(id)), Some("even"));
        let inputs: Vec<_> =
            doc.model.edge(q0, q1).unwrap().iter().map(|i| doc.model.input_symbol_label(*i).unwrap()).collect();
        assert_eq!(inputs, vec!["a"]);
    }

    #[test]
    fn undo_on_an_empty_history_is_a_no_op() {
        let mut doc = MooreDocument::new();
        assert!(!doc.undo());
    }

    #[test]
    fn a_fresh_edit_clears_the_redo_stack() {
        let mut doc = MooreDocument::new();
        doc.apply(vec![MooreEditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]);
        doc.undo();
        doc.apply(vec![MooreEditOp::AddState { label: "q1".into(), x: 0.0, y: 0.0 }]);
        assert!(!doc.redo());
        assert_eq!(doc.model.states().count(), 1);
        assert_eq!(doc.model.state_label(doc.model.states().next().unwrap()), Some("q1"));
    }

    /// Applying a random sequence of edits then undoing each one must
    /// restore the document's observable content exactly at every step —
    /// same invariant/shape as `mealy_doc`'s own round-trip proptest.
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
            SetOutput(String),
            ClearOutput,
            SetTransition(String),
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
                "[x-y]".prop_map(OpKind::SetOutput),
                Just(OpKind::ClearOutput),
                "[a-b]".prop_map(OpKind::SetTransition),
                Just(OpKind::RemoveEdge),
            ]
        }

        fn synthesize(
            created: &mut Vec<StateId>,
            edges: &mut Vec<(StateId, StateId)>,
            next_label: &mut usize,
            kind: OpKind,
        ) -> Option<MooreEditOp> {
            match kind {
                OpKind::AddState => {
                    let label = format!("s{next_label}");
                    *next_label += 1;
                    Some(MooreEditOp::AddState { label, x: 0.0, y: 0.0 })
                }
                OpKind::RemoveState => {
                    if created.is_empty() {
                        return None;
                    }
                    let id = created.remove(0);
                    edges.retain(|(f, t)| *f != id && *t != id);
                    Some(MooreEditOp::RemoveState { id })
                }
                OpKind::MoveState(x, y) => {
                    let id = *created.first()?;
                    Some(MooreEditOp::MoveState { id, x, y })
                }
                OpKind::RenameState(label) => {
                    let id = *created.first()?;
                    Some(MooreEditOp::RenameState { id, label })
                }
                OpKind::SetInitial => {
                    let id = *created.first()?;
                    Some(MooreEditOp::SetInitial { id: Some(id) })
                }
                OpKind::ClearInitial => Some(MooreEditOp::SetInitial { id: None }),
                OpKind::SetOutput(output) => {
                    let id = *created.first()?;
                    Some(MooreEditOp::SetOutput { state: id, output: Some(output) })
                }
                OpKind::ClearOutput => {
                    let id = *created.first()?;
                    Some(MooreEditOp::SetOutput { state: id, output: None })
                }
                OpKind::SetTransition(input) => {
                    if created.len() < 2 {
                        return None;
                    }
                    let from = created[0];
                    let to = created[1 % created.len()];
                    edges.push((from, to));
                    Some(MooreEditOp::SetTransitions { from, to, inputs: vec![input] })
                }
                OpKind::RemoveEdge => {
                    if edges.is_empty() {
                        return None;
                    }
                    let (from, to) = edges.remove(0);
                    Some(MooreEditOp::SetTransitions { from, to, inputs: vec![] })
                }
            }
        }

        type Snapshot = (
            std::collections::BTreeSet<(String, u64, u64, Option<String>)>,
            Option<String>,
            std::collections::BTreeSet<(String, String, String)>,
        );

        fn snapshot(doc: &MooreDoc) -> Snapshot {
            let states = doc
                .states()
                .map(|id| {
                    let meta = doc.state_meta(id).unwrap();
                    let output = meta.output.and_then(|o| doc.output_symbol_label(o)).map(str::to_string);
                    (doc.state_label(id).unwrap().to_string(), meta.x.to_bits(), meta.y.to_bits(), output)
                })
                .collect();
            let initial = doc.initial_state().map(|id| doc.state_label(id).unwrap().to_string());
            let edges = doc
                .edges()
                .flat_map(|((from, to), inputs)| {
                    let from_label = doc.state_label(*from).unwrap().to_string();
                    let to_label = doc.state_label(*to).unwrap().to_string();
                    inputs.iter().map(move |input| {
                        (from_label.clone(), to_label.clone(), doc.input_symbol_label(*input).unwrap().to_string())
                    })
                })
                .collect();
            (states, initial, edges)
        }

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(256))]

            #[test]
            fn matches(kinds in prop::collection::vec(op_kind_strategy(), 0..24)) {
                let mut doc = MooreDocument::new();
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
