//! `PdaDocument`: a `PdaDoc` paired with its own undo/redo history — same
//! shape as `moore_doc::MooreDocument`, genuinely separate type for the same
//! reason `moore_doc.rs` gives. The one structural difference: PDA
//! transitions are individually addressable (see `model::pda`'s doc
//! comment), so instead of a single "replace this edge's whole payload" op
//! like `MealyEditOp::SetTransitions`/`MooreEditOp::SetTransitions`, PDA has
//! separate `AddTransition`/`RemoveTransition`/`EditTransition` ops, each
//! targeting one specific `TransitionId`.

use crate::ids::{StateId, SymbolId};
use crate::model::pda::{PdaDoc, PdaTransition, TransitionId};

/// A single reversible PDA edit — same rules as `MooreEditOp`: labels (not
/// raw ids) for symbols, `apply` never panics on a structurally invalid op
/// (treats it as a no-op with an empty inverse), preconditions are the
/// caller's responsibility.
#[derive(Debug, Clone, PartialEq)]
pub enum PdaEditOp {
    AddState {
        label: String,
        x: f64,
        y: f64,
    },
    /// Inverse-only — see `doc::EditOp::RestoreState`'s doc comment; same D2
    /// free-list LIFO discipline applies here unchanged (shared `Arena`).
    /// Restores geometry/label only; a prior `accepting == true` is restored
    /// by a follow-up `SetAccepting` in the same inverse transaction (see
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
    SetAccepting {
        id: StateId,
        accepting: bool,
    },
    SetInitial {
        id: Option<StateId>,
    },
    /// Allocates a new transition; its inverse (computed at `apply` time,
    /// once the real id is known) is `RemoveTransition`.
    AddTransition {
        from: StateId,
        to: StateId,
        /// `None` = epsilon.
        input: Option<String>,
        pop: Vec<String>,
        push: Vec<String>,
    },
    /// Inverse-only — reinserts a previously-removed transition at its
    /// exact original id, same undo-only role as `RestoreState`.
    RestoreTransition {
        id: TransitionId,
        from: StateId,
        to: StateId,
        input: Option<String>,
        pop: Vec<String>,
        push: Vec<String>,
    },
    RemoveTransition {
        id: TransitionId,
    },
    /// Replaces an existing transition's `(input, pop, push)` payload in
    /// place — endpoints (`from`/`to`) are immutable once created; moving a
    /// transition's endpoints is a remove + add, not an edit.
    EditTransition {
        id: TransitionId,
        input: Option<String>,
        pop: Vec<String>,
        push: Vec<String>,
    },
}

impl PdaEditOp {
    /// Apply this op to `doc`, returning the ops that undo it, in the order
    /// they must be applied to fully reverse this op.
    pub fn apply(self, doc: &mut PdaDoc) -> Vec<PdaEditOp> {
        match self {
            PdaEditOp::AddState { label, x, y } => match doc.add_state(&label, x, y) {
                Ok(id) => vec![PdaEditOp::RemoveState { id }],
                Err(_) => vec![],
            },
            PdaEditOp::RestoreState { id, label, x, y } => match doc.restore_state(id, &label, x, y) {
                Ok(()) => vec![PdaEditOp::RemoveState { id }],
                Err(_) => vec![],
            },
            PdaEditOp::RemoveState { id } => {
                if doc.state_meta(id).is_none() {
                    return vec![];
                }
                let label = doc.state_label(id).unwrap_or("").to_string();
                let meta = *doc.state_meta(id).unwrap();
                let was_initial = doc.initial_state() == Some(id);
                let incident: Vec<(TransitionId, PdaTransition)> = doc
                    .transitions()
                    .filter(|(_, t)| t.from == id || t.to == id)
                    .map(|(tid, t)| (tid, t.clone()))
                    .collect();

                doc.remove_state(id);

                let mut inverse = vec![PdaEditOp::RestoreState { id, label, x: meta.x, y: meta.y }];
                if meta.accepting {
                    inverse.push(PdaEditOp::SetAccepting { id, accepting: true });
                }
                for (tid, t) in incident {
                    let input = t.input.and_then(|s| doc.input_symbol_label(s)).map(str::to_string);
                    let pop = labels(doc, &t.pop);
                    let push = labels(doc, &t.push);
                    inverse.push(PdaEditOp::RestoreTransition { id: tid, from: t.from, to: t.to, input, pop, push });
                }
                if was_initial {
                    inverse.push(PdaEditOp::SetInitial { id: Some(id) });
                }
                inverse
            }
            PdaEditOp::MoveState { id, x, y } => match doc.state_meta(id).copied() {
                None => vec![],
                Some(prev) => {
                    doc.move_state(id, x, y);
                    vec![PdaEditOp::MoveState { id, x: prev.x, y: prev.y }]
                }
            },
            PdaEditOp::RenameState { id, label } => {
                let prev = match doc.state_label(id) {
                    Some(l) => l.to_string(),
                    None => return vec![],
                };
                match doc.rename_state(id, &label) {
                    Ok(()) => vec![PdaEditOp::RenameState { id, label: prev }],
                    Err(_) => vec![],
                }
            }
            PdaEditOp::SetAccepting { id, accepting } => {
                if doc.state_meta(id).is_none() {
                    return vec![];
                }
                let prev = doc.is_accepting(id);
                doc.set_accepting(id, accepting);
                vec![PdaEditOp::SetAccepting { id, accepting: prev }]
            }
            PdaEditOp::SetInitial { id } => {
                let prev = doc.initial_state();
                doc.set_initial(id);
                vec![PdaEditOp::SetInitial { id: prev }]
            }
            PdaEditOp::AddTransition { from, to, input, pop, push } => {
                let input_id = input.as_deref().map(|l| doc.intern_input_symbol(l));
                let pop_ids: Vec<SymbolId> = pop.iter().map(|l| doc.intern_stack_symbol(l)).collect();
                let push_ids: Vec<SymbolId> = push.iter().map(|l| doc.intern_stack_symbol(l)).collect();
                let id = doc.add_transition(from, to, input_id, pop_ids, push_ids);
                vec![PdaEditOp::RemoveTransition { id }]
            }
            PdaEditOp::RestoreTransition { id, from, to, input, pop, push } => {
                let input_id = input.as_deref().map(|l| doc.intern_input_symbol(l));
                let pop_ids: Vec<SymbolId> = pop.iter().map(|l| doc.intern_stack_symbol(l)).collect();
                let push_ids: Vec<SymbolId> = push.iter().map(|l| doc.intern_stack_symbol(l)).collect();
                doc.restore_transition(id, PdaTransition { from, to, input: input_id, pop: pop_ids, push: push_ids });
                vec![PdaEditOp::RemoveTransition { id }]
            }
            PdaEditOp::RemoveTransition { id } => {
                let Some(t) = doc.remove_transition(id) else {
                    return vec![];
                };
                let input = t.input.and_then(|s| doc.input_symbol_label(s)).map(str::to_string);
                let pop = labels(doc, &t.pop);
                let push = labels(doc, &t.push);
                vec![PdaEditOp::RestoreTransition { id, from: t.from, to: t.to, input, pop, push }]
            }
            PdaEditOp::EditTransition { id, input, pop, push } => {
                let Some(prev) = doc.transition(id).cloned() else {
                    return vec![];
                };
                let prev_input = prev.input.and_then(|s| doc.input_symbol_label(s)).map(str::to_string);
                let prev_pop = labels(doc, &prev.pop);
                let prev_push = labels(doc, &prev.push);

                let input_id = input.as_deref().map(|l| doc.intern_input_symbol(l));
                let pop_ids: Vec<SymbolId> = pop.iter().map(|l| doc.intern_stack_symbol(l)).collect();
                let push_ids: Vec<SymbolId> = push.iter().map(|l| doc.intern_stack_symbol(l)).collect();
                doc.edit_transition(id, input_id, pop_ids, push_ids);

                vec![PdaEditOp::EditTransition { id, input: prev_input, pop: prev_pop, push: prev_push }]
            }
        }
    }
}

fn labels(doc: &PdaDoc, ids: &[SymbolId]) -> Vec<String> {
    ids.iter().filter_map(|id| doc.stack_symbol_label(*id)).map(str::to_string).collect()
}

pub type PdaTx = Vec<PdaEditOp>;

/// Same shape as `moore_doc::MooreHistory` — see this module's doc comment
/// for why it's a separate type instead of a shared generic one.
#[derive(Debug, Clone, PartialEq)]
pub struct PdaHistory {
    pub done: Vec<PdaTx>,
    pub undone: Vec<PdaTx>,
    pub limit: usize,
}

impl PdaHistory {
    pub fn new(limit: usize) -> Self {
        PdaHistory { done: Vec::new(), undone: Vec::new(), limit }
    }

    pub fn record(&mut self, inverse_tx: PdaTx) {
        self.push_done(inverse_tx);
        self.undone.clear();
    }

    pub fn push_done(&mut self, tx: PdaTx) {
        self.done.push(tx);
        if self.done.len() > self.limit {
            self.done.remove(0);
        }
    }

    pub fn push_undone(&mut self, tx: PdaTx) {
        self.undone.push(tx);
        if self.undone.len() > self.limit {
            self.undone.remove(0);
        }
    }
}

/// A `PdaDoc` plus its undo/redo history and a monotonically increasing
/// revision counter — same shape as `moore_doc::MooreDocument`.
#[derive(Debug, Clone, PartialEq)]
pub struct PdaDocument {
    pub model: PdaDoc,
    pub history: PdaHistory,
    pub revision: u64,
}

impl Default for PdaDocument {
    fn default() -> Self {
        Self::new()
    }
}

impl PdaDocument {
    pub fn new() -> Self {
        PdaDocument { model: PdaDoc::new(), history: PdaHistory::new(200), revision: 0 }
    }

    /// Apply a batch of ops as one undoable transaction.
    pub fn apply(&mut self, ops: Vec<PdaEditOp>) {
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

    /// Redo the most recently undone transaction. Returns `false` (no-op) if
    /// there is nothing to redo.
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
        let mut doc = PdaDocument::new();
        doc.apply(vec![PdaEditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]);
        assert_eq!(doc.model.states().count(), 1);

        assert!(doc.undo());
        assert_eq!(doc.model.states().count(), 0);

        assert!(doc.redo());
        assert_eq!(doc.model.states().count(), 1);
    }

    #[test]
    fn set_accepting_is_undoable() {
        let mut doc = PdaDocument::new();
        doc.apply(vec![PdaEditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]);
        let q0 = doc.model.states().next().unwrap();

        doc.apply(vec![PdaEditOp::SetAccepting { id: q0, accepting: true }]);
        assert!(doc.model.is_accepting(q0));

        assert!(doc.undo());
        assert!(!doc.model.is_accepting(q0));

        assert!(doc.redo());
        assert!(doc.model.is_accepting(q0));
    }

    #[test]
    fn add_transition_is_undoable() {
        let mut doc = PdaDocument::new();
        doc.apply(vec![
            PdaEditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            PdaEditOp::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ]);
        let q0 = doc.model.states().next().unwrap();
        let q1 = doc.model.states().nth(1).unwrap();

        doc.apply(vec![PdaEditOp::AddTransition {
            from: q0,
            to: q1,
            input: Some("a".into()),
            pop: vec!["Z".into()],
            push: vec!["A".into(), "Z".into()],
        }]);
        assert_eq!(doc.model.transitions().count(), 1);

        assert!(doc.undo());
        assert_eq!(doc.model.transitions().count(), 0);

        assert!(doc.redo());
        assert_eq!(doc.model.transitions().count(), 1);
        let (_, t) = doc.model.transitions().next().unwrap();
        let pop_labels: Vec<_> = t.pop.iter().map(|s| doc.model.stack_symbol_label(*s).unwrap()).collect();
        let push_labels: Vec<_> = t.push.iter().map(|s| doc.model.stack_symbol_label(*s).unwrap()).collect();
        assert_eq!(pop_labels, vec!["Z"]);
        assert_eq!(push_labels, vec!["A", "Z"]);
    }

    #[test]
    fn edit_transition_is_undoable_and_keeps_the_same_id() {
        let mut doc = PdaDocument::new();
        doc.apply(vec![
            PdaEditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            PdaEditOp::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ]);
        let q0 = doc.model.states().next().unwrap();
        let q1 = doc.model.states().nth(1).unwrap();
        doc.apply(vec![PdaEditOp::AddTransition { from: q0, to: q1, input: Some("a".into()), pop: vec![], push: vec![] }]);
        let (id, _) = doc.model.transitions().next().unwrap();

        doc.apply(vec![PdaEditOp::EditTransition { id, input: Some("b".into()), pop: vec!["Z".into()], push: vec![] }]);
        let t = doc.model.transition(id).unwrap();
        assert_eq!(doc.model.input_symbol_label(t.input.unwrap()), Some("b"));

        assert!(doc.undo());
        let t = doc.model.transition(id).unwrap();
        assert_eq!(doc.model.input_symbol_label(t.input.unwrap()), Some("a"));
        assert!(t.pop.is_empty());
    }

    #[test]
    fn removing_a_state_with_transitions_and_accepting_restores_them_exactly_on_undo() {
        let mut doc = PdaDocument::new();
        doc.apply(vec![
            PdaEditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            PdaEditOp::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ]);
        let q0 = doc.model.states().next().unwrap();
        let q1 = doc.model.states().nth(1).unwrap();
        doc.apply(vec![
            PdaEditOp::SetInitial { id: Some(q0) },
            PdaEditOp::SetAccepting { id: q0, accepting: true },
            PdaEditOp::AddTransition { from: q0, to: q1, input: Some("a".into()), pop: vec!["Z".into()], push: vec![] },
        ]);

        doc.apply(vec![PdaEditOp::RemoveState { id: q0 }]);
        assert_eq!(doc.model.states().count(), 1);
        assert_eq!(doc.model.transitions().count(), 0);

        assert!(doc.undo());
        assert_eq!(doc.model.initial_state(), Some(q0));
        assert!(doc.model.is_accepting(q0));
        assert_eq!(doc.model.transitions().count(), 1);
        let (_, t) = doc.model.transitions().next().unwrap();
        assert_eq!(t.from, q0);
        assert_eq!(t.to, q1);
    }

    #[test]
    fn undo_on_an_empty_history_is_a_no_op() {
        let mut doc = PdaDocument::new();
        assert!(!doc.undo());
    }

    #[test]
    fn a_fresh_edit_clears_the_redo_stack() {
        let mut doc = PdaDocument::new();
        doc.apply(vec![PdaEditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]);
        doc.undo();
        doc.apply(vec![PdaEditOp::AddState { label: "q1".into(), x: 0.0, y: 0.0 }]);
        assert!(!doc.redo());
        assert_eq!(doc.model.states().count(), 1);
        assert_eq!(doc.model.state_label(doc.model.states().next().unwrap()), Some("q1"));
    }

    /// Applying a random sequence of edits then undoing each one must
    /// restore the document's observable content exactly at every step —
    /// same invariant/shape as `moore_doc`'s own round-trip proptest,
    /// adapted for individually-addressable transitions instead of one
    /// payload per `(from,to)` edge.
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
            SetAccepting,
            ClearAccepting,
            AddTransition(Option<String>, Vec<String>, Vec<String>),
            RemoveTransition,
            EditTransition(Option<String>, Vec<String>, Vec<String>),
        }

        fn symbol_strategy() -> impl Strategy<Value = String> {
            "[x-y]".prop_map(String::from)
        }

        fn op_kind_strategy() -> impl Strategy<Value = OpKind> {
            prop_oneof![
                Just(OpKind::AddState),
                Just(OpKind::RemoveState),
                (-100.0..100.0f64, -100.0..100.0f64).prop_map(|(x, y)| OpKind::MoveState(x, y)),
                "[a-z][a-z0-9]{0,4}".prop_map(OpKind::RenameState),
                Just(OpKind::SetInitial),
                Just(OpKind::ClearInitial),
                Just(OpKind::SetAccepting),
                Just(OpKind::ClearAccepting),
                (
                    prop::option::of(symbol_strategy()),
                    prop::collection::vec(symbol_strategy(), 0..2),
                    prop::collection::vec(symbol_strategy(), 0..2),
                )
                    .prop_map(|(i, p, u)| OpKind::AddTransition(i, p, u)),
                Just(OpKind::RemoveTransition),
                (
                    prop::option::of(symbol_strategy()),
                    prop::collection::vec(symbol_strategy(), 0..2),
                    prop::collection::vec(symbol_strategy(), 0..2),
                )
                    .prop_map(|(i, p, u)| OpKind::EditTransition(i, p, u)),
            ]
        }

        /// Reads live state directly off `doc` instead of separately
        /// threading a `created`/`transitions` tracking `Vec` (as
        /// `mealy_doc.rs`/`moore_doc.rs`'s equivalent proptests do) — that
        /// tracking-`Vec` approach is fragile here because `StateId`s can
        /// be *reused* after a `RemoveState` (the shared `Arena`'s
        /// free-list, design D2/D4): a manually-tracked "most recently
        /// added" id can silently go stale or point at the wrong state.
        /// Querying `doc.states()`/`doc.transitions()` fresh every call
        /// sidesteps that entirely — always correct by construction.
        fn synthesize(doc: &PdaDoc, next_label: &mut usize, kind: OpKind) -> Option<PdaEditOp> {
            match kind {
                OpKind::AddState => {
                    let label = format!("s{next_label}");
                    *next_label += 1;
                    Some(PdaEditOp::AddState { label, x: 0.0, y: 0.0 })
                }
                OpKind::RemoveState => {
                    let id = doc.states().next()?;
                    Some(PdaEditOp::RemoveState { id })
                }
                OpKind::MoveState(x, y) => {
                    let id = doc.states().next()?;
                    Some(PdaEditOp::MoveState { id, x, y })
                }
                OpKind::RenameState(label) => {
                    let id = doc.states().next()?;
                    Some(PdaEditOp::RenameState { id, label })
                }
                OpKind::SetInitial => {
                    let id = doc.states().next()?;
                    Some(PdaEditOp::SetInitial { id: Some(id) })
                }
                OpKind::ClearInitial => Some(PdaEditOp::SetInitial { id: None }),
                OpKind::SetAccepting => {
                    let id = doc.states().next()?;
                    Some(PdaEditOp::SetAccepting { id, accepting: true })
                }
                OpKind::ClearAccepting => {
                    let id = doc.states().next()?;
                    Some(PdaEditOp::SetAccepting { id, accepting: false })
                }
                OpKind::AddTransition(input, pop, push) => {
                    let mut states = doc.states();
                    let from = states.next()?;
                    let to = states.next().unwrap_or(from);
                    Some(PdaEditOp::AddTransition { from, to, input, pop, push })
                }
                OpKind::RemoveTransition => {
                    let (id, _) = doc.transitions().next()?;
                    Some(PdaEditOp::RemoveTransition { id })
                }
                OpKind::EditTransition(input, pop, push) => {
                    let (id, _) = doc.transitions().next()?;
                    Some(PdaEditOp::EditTransition { id, input, pop, push })
                }
            }
        }

        type Snapshot = (
            std::collections::BTreeSet<(String, u64, u64, bool)>,
            Option<String>,
            std::collections::BTreeSet<(String, String, Option<String>, Vec<String>, Vec<String>)>,
        );

        fn snapshot(doc: &PdaDoc) -> Snapshot {
            let states = doc
                .states()
                .map(|id| {
                    let meta = doc.state_meta(id).unwrap();
                    (doc.state_label(id).unwrap().to_string(), meta.x.to_bits(), meta.y.to_bits(), meta.accepting)
                })
                .collect();
            let initial = doc.initial_state().map(|id| doc.state_label(id).unwrap().to_string());
            let transitions = doc
                .transitions()
                .map(|(_, t)| {
                    let from = doc.state_label(t.from).unwrap().to_string();
                    let to = doc.state_label(t.to).unwrap().to_string();
                    let input = t.input.and_then(|s| doc.input_symbol_label(s)).map(str::to_string);
                    let pop: Vec<String> = t.pop.iter().map(|s| doc.stack_symbol_label(*s).unwrap().to_string()).collect();
                    let push: Vec<String> = t.push.iter().map(|s| doc.stack_symbol_label(*s).unwrap().to_string()).collect();
                    (from, to, input, pop, push)
                })
                .collect();
            (states, initial, transitions)
        }

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(256))]

            #[test]
            fn matches(kinds in prop::collection::vec(op_kind_strategy(), 0..24)) {
                let mut doc = PdaDocument::new();
                let mut next_label = 0usize;
                let mut history_of_snapshots = vec![snapshot(&doc.model)];

                for kind in kinds {
                    if let Some(op) = synthesize(&doc.model, &mut next_label, kind) {
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
