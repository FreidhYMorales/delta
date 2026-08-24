//! `TmDocument`: a `TmDoc` paired with its own undo/redo history — same
//! shape as `pda_doc::PdaDocument`, genuinely separate type for the same
//! reason `pda_doc.rs` gives. Transitions are individually addressable
//! (see `model::tm`'s doc comment), so like PDA, TM has separate
//! `AddTransition`/`RemoveTransition`/`EditTransition` ops instead of a
//! single "replace this edge's whole payload" op.

use crate::ids::StateId;
use crate::model::tm::{Direction, TmDoc, TmTapeOp, TmTransition, TransitionId};

/// One tape's read/write/direction, label-addressed (not raw `SymbolId`) —
/// same "labels, not ids, cross the edit-op boundary" rule as `PdaEditOp`.
#[derive(Debug, Clone, PartialEq)]
pub struct TapeOpSpec {
    pub read: String,
    pub write: String,
    pub direction: Direction,
}

/// A single reversible TM edit — same rules as `PdaEditOp`: labels (not raw
/// ids) for symbols, `apply` never panics on a structurally invalid op
/// (treats it as a no-op with an empty inverse), preconditions are the
/// caller's responsibility.
#[derive(Debug, Clone, PartialEq)]
pub enum TmEditOp {
    AddState {
        label: String,
        x: f64,
        y: f64,
    },
    /// Inverse-only — see `PdaEditOp::RestoreState`'s doc comment; same D2
    /// free-list LIFO discipline applies here unchanged (shared `Arena`).
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
    /// once the real id is known) is `RemoveTransition`. A no-op (empty
    /// inverse) if `tapes.len()` doesn't match the document's tape count —
    /// see `TmDoc::add_transition`'s doc comment.
    AddTransition {
        from: StateId,
        to: StateId,
        tapes: Vec<TapeOpSpec>,
    },
    /// Inverse-only — reinserts a previously-removed transition at its
    /// exact original id, same undo-only role as `RestoreState`.
    RestoreTransition {
        id: TransitionId,
        from: StateId,
        to: StateId,
        tapes: Vec<TapeOpSpec>,
    },
    RemoveTransition {
        id: TransitionId,
    },
    /// Replaces an existing transition's `tapes` payload in place —
    /// endpoints (`from`/`to`) are immutable once created, same convention
    /// as `PdaEditOp::EditTransition`.
    EditTransition {
        id: TransitionId,
        tapes: Vec<TapeOpSpec>,
    },
}

fn intern_tapes(doc: &mut TmDoc, tapes: &[TapeOpSpec]) -> Vec<TmTapeOp> {
    tapes
        .iter()
        .map(|spec| TmTapeOp {
            read: doc.intern_symbol(&spec.read),
            write: doc.intern_symbol(&spec.write),
            direction: spec.direction,
        })
        .collect()
}

fn tape_specs(doc: &TmDoc, tapes: &[TmTapeOp]) -> Vec<TapeOpSpec> {
    tapes
        .iter()
        .map(|op| TapeOpSpec {
            read: doc.symbol_label(op.read).unwrap_or("").to_string(),
            write: doc.symbol_label(op.write).unwrap_or("").to_string(),
            direction: op.direction,
        })
        .collect()
}

impl TmEditOp {
    /// Apply this op to `doc`, returning the ops that undo it, in the order
    /// they must be applied to fully reverse this op.
    pub fn apply(self, doc: &mut TmDoc) -> Vec<TmEditOp> {
        match self {
            TmEditOp::AddState { label, x, y } => match doc.add_state(&label, x, y) {
                Ok(id) => vec![TmEditOp::RemoveState { id }],
                Err(_) => vec![],
            },
            TmEditOp::RestoreState { id, label, x, y } => match doc.restore_state(id, &label, x, y) {
                Ok(()) => vec![TmEditOp::RemoveState { id }],
                Err(_) => vec![],
            },
            TmEditOp::RemoveState { id } => {
                if doc.state_meta(id).is_none() {
                    return vec![];
                }
                let label = doc.state_label(id).unwrap_or("").to_string();
                let meta = *doc.state_meta(id).unwrap();
                let was_initial = doc.initial_state() == Some(id);
                let incident: Vec<(TransitionId, TmTransition)> = doc
                    .transitions()
                    .filter(|(_, t)| t.from == id || t.to == id)
                    .map(|(tid, t)| (tid, t.clone()))
                    .collect();

                doc.remove_state(id);

                let mut inverse = vec![TmEditOp::RestoreState { id, label, x: meta.x, y: meta.y }];
                if meta.accepting {
                    inverse.push(TmEditOp::SetAccepting { id, accepting: true });
                }
                for (tid, t) in incident {
                    let tapes = tape_specs(doc, &t.tapes);
                    inverse.push(TmEditOp::RestoreTransition { id: tid, from: t.from, to: t.to, tapes });
                }
                if was_initial {
                    inverse.push(TmEditOp::SetInitial { id: Some(id) });
                }
                inverse
            }
            TmEditOp::MoveState { id, x, y } => match doc.state_meta(id).copied() {
                None => vec![],
                Some(prev) => {
                    doc.move_state(id, x, y);
                    vec![TmEditOp::MoveState { id, x: prev.x, y: prev.y }]
                }
            },
            TmEditOp::RenameState { id, label } => {
                let prev = match doc.state_label(id) {
                    Some(l) => l.to_string(),
                    None => return vec![],
                };
                match doc.rename_state(id, &label) {
                    Ok(()) => vec![TmEditOp::RenameState { id, label: prev }],
                    Err(_) => vec![],
                }
            }
            TmEditOp::SetAccepting { id, accepting } => {
                if doc.state_meta(id).is_none() {
                    return vec![];
                }
                let prev = doc.is_accepting(id);
                doc.set_accepting(id, accepting);
                vec![TmEditOp::SetAccepting { id, accepting: prev }]
            }
            TmEditOp::SetInitial { id } => {
                let prev = doc.initial_state();
                doc.set_initial(id);
                vec![TmEditOp::SetInitial { id: prev }]
            }
            TmEditOp::AddTransition { from, to, tapes } => {
                let ops = intern_tapes(doc, &tapes);
                match doc.add_transition(from, to, ops) {
                    Some(id) => vec![TmEditOp::RemoveTransition { id }],
                    None => vec![],
                }
            }
            TmEditOp::RestoreTransition { id, from, to, tapes } => {
                let ops = intern_tapes(doc, &tapes);
                doc.restore_transition(id, TmTransition { from, to, tapes: ops });
                vec![TmEditOp::RemoveTransition { id }]
            }
            TmEditOp::RemoveTransition { id } => {
                let Some(t) = doc.remove_transition(id) else {
                    return vec![];
                };
                let tapes = tape_specs(doc, &t.tapes);
                vec![TmEditOp::RestoreTransition { id, from: t.from, to: t.to, tapes }]
            }
            TmEditOp::EditTransition { id, tapes } => {
                let Some(prev) = doc.transition(id).cloned() else {
                    return vec![];
                };
                let prev_tapes = tape_specs(doc, &prev.tapes);
                let ops = intern_tapes(doc, &tapes);
                if !doc.edit_transition(id, ops) {
                    return vec![];
                }
                vec![TmEditOp::EditTransition { id, tapes: prev_tapes }]
            }
        }
    }
}

pub type TmTx = Vec<TmEditOp>;

/// Same shape as `pda_doc::PdaHistory` — see this module's doc comment for
/// why it's a separate type instead of a shared generic one.
#[derive(Debug, Clone, PartialEq)]
pub struct TmHistory {
    pub done: Vec<TmTx>,
    pub undone: Vec<TmTx>,
    pub limit: usize,
}

impl TmHistory {
    pub fn new(limit: usize) -> Self {
        TmHistory { done: Vec::new(), undone: Vec::new(), limit }
    }

    pub fn record(&mut self, inverse_tx: TmTx) {
        self.push_done(inverse_tx);
        self.undone.clear();
    }

    pub fn push_done(&mut self, tx: TmTx) {
        self.done.push(tx);
        if self.done.len() > self.limit {
            self.done.remove(0);
        }
    }

    pub fn push_undone(&mut self, tx: TmTx) {
        self.undone.push(tx);
        if self.undone.len() > self.limit {
            self.undone.remove(0);
        }
    }
}

/// A `TmDoc` plus its undo/redo history and a monotonically increasing
/// revision counter — same shape as `pda_doc::PdaDocument`.
#[derive(Debug, Clone, PartialEq)]
pub struct TmDocument {
    pub model: TmDoc,
    pub history: TmHistory,
    pub revision: u64,
}

impl Default for TmDocument {
    fn default() -> Self {
        Self::new()
    }
}

impl TmDocument {
    pub fn new() -> Self {
        TmDocument { model: TmDoc::new(), history: TmHistory::new(200), revision: 0 }
    }

    /// Apply a batch of ops as one undoable transaction.
    pub fn apply(&mut self, ops: Vec<TmEditOp>) {
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

    fn spec(read: &str, write: &str, direction: Direction) -> TapeOpSpec {
        TapeOpSpec { read: read.into(), write: write.into(), direction }
    }

    #[test]
    fn apply_add_state_is_undoable() {
        let mut doc = TmDocument::new();
        doc.apply(vec![TmEditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]);
        assert_eq!(doc.model.states().count(), 1);

        assert!(doc.undo());
        assert_eq!(doc.model.states().count(), 0);

        assert!(doc.redo());
        assert_eq!(doc.model.states().count(), 1);
    }

    #[test]
    fn set_accepting_is_undoable() {
        let mut doc = TmDocument::new();
        doc.apply(vec![TmEditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]);
        let q0 = doc.model.states().next().unwrap();

        doc.apply(vec![TmEditOp::SetAccepting { id: q0, accepting: true }]);
        assert!(doc.model.is_accepting(q0));

        assert!(doc.undo());
        assert!(!doc.model.is_accepting(q0));

        assert!(doc.redo());
        assert!(doc.model.is_accepting(q0));
    }

    #[test]
    fn add_transition_is_undoable() {
        let mut doc = TmDocument::new();
        doc.apply(vec![
            TmEditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            TmEditOp::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ]);
        let q0 = doc.model.states().next().unwrap();
        let q1 = doc.model.states().nth(1).unwrap();

        doc.apply(vec![TmEditOp::AddTransition {
            from: q0,
            to: q1,
            tapes: vec![spec("a", "b", Direction::Right)],
        }]);
        assert_eq!(doc.model.transitions().count(), 1);

        assert!(doc.undo());
        assert_eq!(doc.model.transitions().count(), 0);

        assert!(doc.redo());
        assert_eq!(doc.model.transitions().count(), 1);
        let (_, t) = doc.model.transitions().next().unwrap();
        assert_eq!(doc.model.symbol_label(t.tapes[0].read), Some("a"));
        assert_eq!(doc.model.symbol_label(t.tapes[0].write), Some("b"));
    }

    #[test]
    fn adding_a_transition_with_the_wrong_tape_count_is_a_no_op_transaction() {
        let mut doc = TmDocument::new();
        doc.apply(vec![
            TmEditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            TmEditOp::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ]);
        let q0 = doc.model.states().next().unwrap();
        let q1 = doc.model.states().nth(1).unwrap();
        doc.apply(vec![TmEditOp::AddTransition { from: q0, to: q1, tapes: vec![spec("a", "a", Direction::Right)] }]);
        assert_eq!(doc.model.tape_count(), 1);

        doc.apply(vec![TmEditOp::AddTransition {
            from: q0,
            to: q1,
            tapes: vec![spec("a", "a", Direction::Right), spec("b", "b", Direction::Left)],
        }]);
        assert_eq!(doc.model.transitions().count(), 1, "the 2-tape transition must have been rejected");

        // The rejected add still recorded an (empty) transaction, so undo()
        // pops *that* one — a true no-op, leaving the real 1-tape
        // transition from before untouched.
        assert!(doc.undo());
        assert_eq!(doc.model.transitions().count(), 1, "undoing the rejected no-op must not touch the earlier real transition");
    }

    #[test]
    fn edit_transition_is_undoable_and_keeps_the_same_id() {
        let mut doc = TmDocument::new();
        doc.apply(vec![
            TmEditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            TmEditOp::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ]);
        let q0 = doc.model.states().next().unwrap();
        let q1 = doc.model.states().nth(1).unwrap();
        doc.apply(vec![TmEditOp::AddTransition { from: q0, to: q1, tapes: vec![spec("a", "a", Direction::Right)] }]);
        let (id, _) = doc.model.transitions().next().unwrap();

        doc.apply(vec![TmEditOp::EditTransition { id, tapes: vec![spec("b", "c", Direction::Stay)] }]);
        let t = doc.model.transition(id).unwrap();
        assert_eq!(doc.model.symbol_label(t.tapes[0].read), Some("b"));

        assert!(doc.undo());
        let t = doc.model.transition(id).unwrap();
        assert_eq!(doc.model.symbol_label(t.tapes[0].read), Some("a"));
    }

    #[test]
    fn removing_a_state_with_transitions_and_accepting_restores_them_exactly_on_undo() {
        let mut doc = TmDocument::new();
        doc.apply(vec![
            TmEditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            TmEditOp::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ]);
        let q0 = doc.model.states().next().unwrap();
        let q1 = doc.model.states().nth(1).unwrap();
        doc.apply(vec![
            TmEditOp::SetInitial { id: Some(q0) },
            TmEditOp::SetAccepting { id: q0, accepting: true },
            TmEditOp::AddTransition { from: q0, to: q1, tapes: vec![spec("a", "a", Direction::Right)] },
        ]);

        doc.apply(vec![TmEditOp::RemoveState { id: q0 }]);
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
        let mut doc = TmDocument::new();
        assert!(!doc.undo());
    }

    #[test]
    fn a_fresh_edit_clears_the_redo_stack() {
        let mut doc = TmDocument::new();
        doc.apply(vec![TmEditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]);
        doc.undo();
        doc.apply(vec![TmEditOp::AddState { label: "q1".into(), x: 0.0, y: 0.0 }]);
        assert!(!doc.redo());
        assert_eq!(doc.model.states().count(), 1);
        assert_eq!(doc.model.state_label(doc.model.states().next().unwrap()), Some("q1"));
    }

    /// Applying a random sequence of edits then undoing each one must
    /// restore the document's observable content exactly at every step —
    /// same invariant/shape as `pda_doc`'s own round-trip proptest, and
    /// written the same *correct* way: synthesizing ops by reading
    /// `doc.states()`/`doc.transitions()` live rather than a separately
    /// tracked `Vec<StateId>` (the flaw the earlier Mealy/Moore proptests
    /// had — docs/decisions.md — that PDA's own proptest already fixed).
    /// All transitions here use a single tape throughout, since `tape_count`
    /// locks in on the first one and this proptest's `AddTransition` kind
    /// always offers exactly one tape — `EditTransition` is likewise
    /// single-tape, so no random synthesized op could ever hit the
    /// wrong-tape-count rejection path (covered by its own dedicated test
    /// above instead).
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
            AddTransition(String, String, Direction),
            RemoveTransition,
            EditTransition(String, String, Direction),
        }

        fn symbol_strategy() -> impl Strategy<Value = String> {
            "[x-y]".prop_map(String::from)
        }

        fn direction_strategy() -> impl Strategy<Value = Direction> {
            prop_oneof![Just(Direction::Left), Just(Direction::Right), Just(Direction::Stay)]
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
                (symbol_strategy(), symbol_strategy(), direction_strategy())
                    .prop_map(|(r, w, d)| OpKind::AddTransition(r, w, d)),
                Just(OpKind::RemoveTransition),
                (symbol_strategy(), symbol_strategy(), direction_strategy())
                    .prop_map(|(r, w, d)| OpKind::EditTransition(r, w, d)),
            ]
        }

        fn synthesize(doc: &TmDoc, next_label: &mut usize, kind: OpKind) -> Option<TmEditOp> {
            match kind {
                OpKind::AddState => {
                    let label = format!("s{next_label}");
                    *next_label += 1;
                    Some(TmEditOp::AddState { label, x: 0.0, y: 0.0 })
                }
                OpKind::RemoveState => {
                    let id = doc.states().next()?;
                    Some(TmEditOp::RemoveState { id })
                }
                OpKind::MoveState(x, y) => {
                    let id = doc.states().next()?;
                    Some(TmEditOp::MoveState { id, x, y })
                }
                OpKind::RenameState(label) => {
                    let id = doc.states().next()?;
                    Some(TmEditOp::RenameState { id, label })
                }
                OpKind::SetInitial => {
                    let id = doc.states().next()?;
                    Some(TmEditOp::SetInitial { id: Some(id) })
                }
                OpKind::ClearInitial => Some(TmEditOp::SetInitial { id: None }),
                OpKind::SetAccepting => {
                    let id = doc.states().next()?;
                    Some(TmEditOp::SetAccepting { id, accepting: true })
                }
                OpKind::ClearAccepting => {
                    let id = doc.states().next()?;
                    Some(TmEditOp::SetAccepting { id, accepting: false })
                }
                OpKind::AddTransition(read, write, direction) => {
                    let mut states = doc.states();
                    let from = states.next()?;
                    let to = states.next().unwrap_or(from);
                    Some(TmEditOp::AddTransition { from, to, tapes: vec![TapeOpSpec { read, write, direction }] })
                }
                OpKind::RemoveTransition => {
                    let (id, _) = doc.transitions().next()?;
                    Some(TmEditOp::RemoveTransition { id })
                }
                OpKind::EditTransition(read, write, direction) => {
                    let (id, _) = doc.transitions().next()?;
                    Some(TmEditOp::EditTransition { id, tapes: vec![TapeOpSpec { read, write, direction }] })
                }
            }
        }

        type Snapshot = (
            std::collections::BTreeSet<(String, u64, u64, bool)>,
            Option<String>,
            std::collections::BTreeSet<(String, String, String, String, u8)>,
        );

        fn direction_tag(d: Direction) -> u8 {
            match d {
                Direction::Left => 0,
                Direction::Right => 1,
                Direction::Stay => 2,
            }
        }

        fn snapshot(doc: &TmDoc) -> Snapshot {
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
                    let op = &t.tapes[0];
                    (
                        from,
                        to,
                        doc.symbol_label(op.read).unwrap().to_string(),
                        doc.symbol_label(op.write).unwrap().to_string(),
                        direction_tag(op.direction),
                    )
                })
                .collect();
            (states, initial, transitions)
        }

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(256))]

            #[test]
            fn matches(kinds in prop::collection::vec(op_kind_strategy(), 0..24)) {
                let mut doc = TmDocument::new();
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
