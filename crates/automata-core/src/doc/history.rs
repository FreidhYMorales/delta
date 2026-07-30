//! Transactional undo/redo log. `Tx` is a batch of `EditOp`s applied
//! together (mirrors the prototype's batched `edit()` block); `History`
//! keeps the done/undone stacks, each bounded by `limit` (design D4).

use super::EditOp;

pub type Tx = Vec<EditOp>;

#[derive(Debug, Clone, PartialEq)]
pub struct History {
    pub done: Vec<Tx>,
    pub undone: Vec<Tx>,
    pub limit: usize,
}

impl History {
    pub fn new(limit: usize) -> Self {
        History {
            done: Vec::new(),
            undone: Vec::new(),
            limit,
        }
    }

    /// Record a freshly-applied transaction's inverse. Clears the redo
    /// stack (a new edit invalidates any previously-undone future).
    pub fn record(&mut self, inverse_tx: Tx) {
        self.push_done(inverse_tx);
        self.undone.clear();
    }

    /// Push onto `done` without touching `undone` (used by `redo`, which
    /// must not clear the stack it is popping from).
    pub fn push_done(&mut self, tx: Tx) {
        self.done.push(tx);
        if self.done.len() > self.limit {
            self.done.remove(0);
        }
    }

    /// Push onto `undone` (used by `undo`).
    pub fn push_undone(&mut self, tx: Tx) {
        self.undone.push(tx);
        if self.undone.len() > self.limit {
            self.undone.remove(0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::Document;
    use crate::ids::StateId;
    use crate::model::fa::FaDoc;
    use proptest::prelude::*;

    /// Abstract op kinds the proptest generator picks from; `synthesize`
    /// turns a kind into a concrete, structurally-valid `EditOp` against the
    /// document's *current* state, or `None` to skip a step whose
    /// precondition isn't met (e.g. renaming when no state exists yet).
    #[derive(Debug, Clone)]
    enum OpKind {
        AddState,
        RemoveState,
        MoveState(f64, f64),
        RenameState(String),
        SetInitial,
        ClearInitial,
        ToggleAccepting,
        AddEdge(String),
        AddEpsilonEdge,
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
            Just(OpKind::ToggleAccepting),
            "[a-b]".prop_map(OpKind::AddEdge),
            Just(OpKind::AddEpsilonEdge),
            Just(OpKind::RemoveEdge),
        ]
    }

    /// Synthesize a concrete `EditOp` from `kind`, tracking created states
    /// and edges so later ops reference ids/pairs that are actually alive.
    fn synthesize(
        created: &mut Vec<StateId>,
        edges: &mut Vec<(StateId, StateId)>,
        next_label: &mut usize,
        kind: OpKind,
    ) -> Option<EditOp> {
        match kind {
            OpKind::AddState => {
                let label = format!("s{next_label}");
                *next_label += 1;
                Some(EditOp::AddState { label, x: 0.0, y: 0.0 })
            }
            OpKind::RemoveState => {
                if created.is_empty() {
                    return None;
                }
                let idx = 0; // always remove the oldest tracked state
                let id = created.remove(idx);
                edges.retain(|(f, t)| *f != id && *t != id);
                Some(EditOp::RemoveState { id })
            }
            OpKind::MoveState(x, y) => {
                let id = *created.first()?;
                Some(EditOp::MoveState { id, x, y })
            }
            OpKind::RenameState(label) => {
                let id = *created.first()?;
                Some(EditOp::RenameState { id, label })
            }
            OpKind::SetInitial => {
                let id = *created.first()?;
                Some(EditOp::SetInitial { id: Some(id) })
            }
            OpKind::ClearInitial => Some(EditOp::SetInitial { id: None }),
            OpKind::ToggleAccepting => {
                let id = *created.first()?;
                Some(EditOp::SetAccepting { id, accepting: true })
            }
            OpKind::AddEdge(symbol) => {
                if created.len() < 2 {
                    return None;
                }
                let from = created[0];
                let to = created[1 % created.len()];
                edges.push((from, to));
                Some(EditOp::SetEdge {
                    from,
                    to,
                    epsilon: false,
                    symbols: vec![symbol],
                })
            }
            OpKind::AddEpsilonEdge => {
                if created.len() < 2 {
                    return None;
                }
                let from = created[0];
                let to = created[1 % created.len()];
                edges.push((from, to));
                Some(EditOp::SetEdge {
                    from,
                    to,
                    epsilon: true,
                    symbols: vec![],
                })
            }
            OpKind::RemoveEdge => {
                if edges.is_empty() {
                    return None;
                }
                let (from, to) = edges.remove(0);
                Some(EditOp::SetEdge { from, to, epsilon: false, symbols: vec![] })
            }
        }
    }

    /// Order-independent, id-independent snapshot of a document's
    /// *observable* content: state labels/geometry/flags, the initial
    /// state's label, and edges keyed by endpoint labels. Deliberately
    /// ignores internal `Arena` bookkeeping (tombstoned/free slots), which
    /// is an implementation detail, not part of document identity — an
    /// undo that restores a state reuses its exact `StateId` (design D4)
    /// but the freed-then-reallocated arena slot is not required to be
    /// byte-identical to a slot that was never touched.
    type Snapshot = (
        std::collections::BTreeSet<(String, u64, u64, bool)>,
        Option<String>,
        std::collections::BTreeSet<(String, String, bool, Vec<String>)>,
    );

    fn snapshot(doc: &FaDoc) -> Snapshot {
        let states = doc
            .states()
            .map(|id| {
                let meta = doc.state_meta(id).unwrap();
                (
                    doc.state_label(id).unwrap().to_string(),
                    meta.x.to_bits(),
                    meta.y.to_bits(),
                    meta.accepting,
                )
            })
            .collect();
        let initial = doc
            .initial_state()
            .map(|id| doc.state_label(id).unwrap().to_string());
        let edges = doc
            .edges()
            .map(|((from, to), set)| {
                let mut symbols: Vec<String> = set
                    .symbols
                    .iter()
                    .map(|s| doc.symbol_label(*s).unwrap().to_string())
                    .collect();
                symbols.sort();
                (
                    doc.state_label(*from).unwrap().to_string(),
                    doc.state_label(*to).unwrap().to_string(),
                    set.epsilon,
                    symbols,
                )
            })
            .collect();
        (states, initial, edges)
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        /// Applying a sequence of edits then undoing each one (in reverse
        /// order, via `Document::undo`) must restore the document's
        /// observable content exactly to its state before that edit — the
        /// core undo-correctness invariant (design D4).
        #[test]
        fn apply_then_undo_round_trip(kinds in prop::collection::vec(op_kind_strategy(), 0..24)) {
            let mut doc = Document::new();
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
