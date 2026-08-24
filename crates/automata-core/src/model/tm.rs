//! Edit-facing Turing Machine document (`TmDoc`) — a new, isolated model,
//! following the same "isolate when shapes differ" principle the
//! Mealy/Moore/PDA backends established (see docs/decisions.md).
//!
//! Ground truth verified by decompiling real JFLAP's
//! `automata.turing.{TuringMachine,TMTransition,TMState,Tape,TMConfiguration,
//! TMSimulator,NDTMSimulator,AcceptanceEnum,AcceptByFinalStateFilter,
//! AcceptByHaltingFilter}` with `cfr`:
//!  - `TuringMachine extends Automaton` directly — a TM **does** have
//!    accepting states, same as PDA/FA.
//!  - **TM is genuinely multi-tape from JFLAP's own base model**, not
//!    single-tape-with-multi-tape-bolted-on-later: `TuringMachine` carries an
//!    `int tapes` field (constructor default 1), and `TMTransition` is built
//!    from three *parallel arrays* (`toRead`/`toWrite`/`direction`), one
//!    triple per tape. `TuringMachine.addTransition` enforces every
//!    transition added has the same tape count as the automaton's own —
//!    `tapes == 0` means "not yet determined"; the *first* transition added
//!    locks it in, and it never resets back to 0 even if every transition is
//!    later removed (mirrored exactly by [`TmDoc::tape_count`] below).
//!    "TM With Building Blocks" (hierarchical/nested sub-automaton
//!    composition, `TuringMachineBuildingBlocks`, `TMTransition.blockTransition`)
//!    is a genuinely separate, later feature — out of scope entirely here.
//!  - Read/write symbols are exactly one atomic symbol each ("Read string
//!    must have exactly one character!", "Write string must have exactly one
//!    character!") — generalized here to one atomic [`SymbolId`], the same
//!    way `model::pda` generalizes JFLAP's single-char stack strings.
//!    **Deliberately out of scope, deferred**: JFLAP's wildcard/variable
//!    read-symbol extensions (`!x` = not-x, `~` = any-symbol wildcard,
//!    `{var}` = variable capture) — this backend only ever does exact
//!    atomic-symbol matching per tape, same documented-scope-cut treatment
//!    `PdaDoc::is_deterministic`'s own edit-time-heuristic limitation gets.
//!  - Direction is three-way: `L`/`R`/`S` (stay — `Tape.moveHead`'s
//!    `case 'S': break`, no movement) — new vs. PDA, which had no "stay".
//!  - Transitions are **individually addressable**, exactly PDA's own
//!    already-proven shape: several can share the same `(from, to)` pair
//!    with different per-tape read/write/direction combos. Each gets its own
//!    [`TransitionId`] — a fresh newtype, deliberately not
//!    `model::pda::TransitionId`, for the same type-safety reasoning every
//!    machine kind already gets its own id types.
//!  - One shared tape-symbol `Arena<SymbolId>` across every tape (unlike
//!    PDA's two genuinely separate alphabets) — a TM's read/write symbols
//!    are the same alphabet. The blank glyph `"□"` (U+25A1, JFLAP's own
//!    `TMTransition.BLANK`/`Tape.BLANK`) is interned up front in
//!    [`TmDoc::new`], so it always exists even in an empty document.
//!  - Accept mode (final state vs. halting) is a **simulation-time** choice,
//!    never stored on the document — same reasoning as PDA's accept mode,
//!    handled entirely in `engine::tm`, not here.

use std::collections::HashMap;

use crate::ids::{Arena, ArenaError, StateId, SymbolId};

/// JFLAP's own blank-tape glyph (`Tape.BLANK` / `TMTransition.BLANK`, U+25A1
/// WHITE SQUARE).
pub const BLANK: &str = "\u{25a1}";

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TmStateMeta {
    pub x: f64,
    pub y: f64,
    pub accepting: bool,
}

/// Opaque id for one transition rule — a plain monotonic counter, same
/// non-arena rationale as `model::pda::TransitionId`'s doc comment (no
/// name-based lookup is ever needed for a transition).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct TransitionId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Direction {
    Left,
    Right,
    Stay,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TmTapeOp {
    pub read: SymbolId,
    pub write: SymbolId,
    pub direction: Direction,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TmTransition {
    pub from: StateId,
    pub to: StateId,
    /// One op per tape, `tapes.len() == TmDoc::tape_count()` once that's
    /// locked in (see this module's doc comment).
    pub tapes: Vec<TmTapeOp>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TmDoc {
    states: Arena<StateId>,
    state_meta: HashMap<StateId, TmStateMeta>,
    initial: Option<StateId>,
    symbols: Arena<SymbolId>,
    blank: SymbolId,
    transitions: HashMap<TransitionId, TmTransition>,
    next_transition_id: u32,
    /// `0` = not yet determined (no transition added yet). Locked in by the
    /// first transition added and never reset afterward, even if every
    /// transition is later removed — mirrors `TuringMachine.tapes` exactly.
    tape_count: usize,
}

impl Default for TmDoc {
    fn default() -> Self {
        Self::new()
    }
}

impl TmDoc {
    pub fn new() -> Self {
        let mut symbols = Arena::new();
        let blank = symbols.alloc(BLANK).expect("fresh arena, BLANK not yet used");
        TmDoc {
            states: Arena::new(),
            state_meta: HashMap::new(),
            initial: None,
            symbols,
            blank,
            transitions: HashMap::new(),
            next_transition_id: 0,
            tape_count: 0,
        }
    }

    // -- states -------------------------------------------------------------

    pub fn add_state(&mut self, label: &str, x: f64, y: f64) -> Result<StateId, ArenaError> {
        let id = self.states.alloc(label)?;
        self.state_meta.insert(id, TmStateMeta { x, y, accepting: false });
        Ok(id)
    }

    /// Reconstruct a previously-removed state at its exact original id —
    /// undo-only, same role as `PdaDoc::restore_state`.
    pub fn restore_state(&mut self, id: StateId, label: &str, x: f64, y: f64) -> Result<(), ArenaError> {
        self.states.alloc_at(id, label)?;
        self.state_meta.insert(id, TmStateMeta { x, y, accepting: false });
        Ok(())
    }

    /// Remove a state, cascading removal of every incident transition and
    /// clearing `initial` if this was the initial state. No-op if `id` is
    /// not alive.
    pub fn remove_state(&mut self, id: StateId) {
        if !self.states.is_alive(id) {
            return;
        }
        self.states.free(id);
        self.state_meta.remove(&id);
        if self.initial == Some(id) {
            self.initial = None;
        }
        self.transitions.retain(|_, t| t.from != id && t.to != id);
    }

    pub fn states(&self) -> impl Iterator<Item = StateId> + '_ {
        self.states.iter_alive()
    }

    pub fn state_label(&self, id: StateId) -> Option<&str> {
        self.states.label(id)
    }

    pub fn state_meta(&self, id: StateId) -> Option<&TmStateMeta> {
        self.state_meta.get(&id)
    }

    pub fn state_capacity(&self) -> usize {
        self.states.capacity()
    }

    pub fn rename_state(&mut self, id: StateId, label: &str) -> Result<(), ArenaError> {
        self.states.rename(id, label)
    }

    pub fn move_state(&mut self, id: StateId, x: f64, y: f64) {
        if let Some(meta) = self.state_meta.get_mut(&id) {
            meta.x = x;
            meta.y = y;
        }
    }

    pub fn set_initial(&mut self, id: Option<StateId>) {
        self.initial = id;
    }

    pub fn initial_state(&self) -> Option<StateId> {
        self.initial
    }

    pub fn is_accepting(&self, id: StateId) -> bool {
        self.state_meta.get(&id).map(|m| m.accepting).unwrap_or(false)
    }

    pub fn set_accepting(&mut self, id: StateId, accepting: bool) {
        if let Some(meta) = self.state_meta.get_mut(&id) {
            meta.accepting = accepting;
        }
    }

    // -- symbols --------------------------------------------------------------

    pub fn intern_symbol(&mut self, label: &str) -> SymbolId {
        if let Some(id) = self.symbols.id_for_label(label) {
            return id;
        }
        self.symbols.alloc(label).expect("label just checked absent from label_index")
    }

    pub fn symbol_label(&self, id: SymbolId) -> Option<&str> {
        self.symbols.label(id)
    }

    pub fn symbol_label_to_id(&self, label: &str) -> Option<SymbolId> {
        self.symbols.id_for_label(label)
    }

    /// The interned blank-tape symbol (`BLANK`, `"□"`) — always present,
    /// even in a fresh document.
    pub fn blank_symbol(&self) -> SymbolId {
        self.blank
    }

    // -- tape count -----------------------------------------------------------

    /// `0` until the first transition is added; never resets afterward. See
    /// this module's doc comment.
    pub fn tape_count(&self) -> usize {
        self.tape_count
    }

    // -- transitions ----------------------------------------------------------

    /// Allocate a new transition and return its fresh id — `None` if
    /// `tapes.len()` doesn't match the document's locked-in `tape_count`
    /// (once one exists) or is `0` (a transition always needs at least one
    /// tape). Locks in `tape_count` from this transition if it's the first
    /// one ever added (`tape_count() == 0`).
    pub fn add_transition(&mut self, from: StateId, to: StateId, tapes: Vec<TmTapeOp>) -> Option<TransitionId> {
        if tapes.is_empty() {
            return None;
        }
        if self.tape_count == 0 {
            self.tape_count = tapes.len();
        } else if tapes.len() != self.tape_count {
            return None;
        }
        let id = TransitionId(self.next_transition_id);
        self.next_transition_id += 1;
        self.transitions.insert(id, TmTransition { from, to, tapes });
        Some(id)
    }

    /// Reinsert a transition at a specific, previously-removed id —
    /// undo-only, same role as `PdaDoc::restore_transition`. Does not
    /// re-validate against `tape_count` (it already matched when originally
    /// added, and `tape_count` never changes once locked in) or touch
    /// `next_transition_id`.
    pub fn restore_transition(&mut self, id: TransitionId, transition: TmTransition) {
        self.transitions.insert(id, transition);
    }

    pub fn remove_transition(&mut self, id: TransitionId) -> Option<TmTransition> {
        self.transitions.remove(&id)
    }

    /// Replace an existing transition's `tapes` payload in place, keeping
    /// its id and endpoints. No-op (returns `false`) if `id` doesn't exist
    /// or `tapes.len()` doesn't match `tape_count`.
    pub fn edit_transition(&mut self, id: TransitionId, tapes: Vec<TmTapeOp>) -> bool {
        if tapes.len() != self.tape_count {
            return false;
        }
        let Some(t) = self.transitions.get_mut(&id) else {
            return false;
        };
        t.tapes = tapes;
        true
    }

    pub fn transition(&self, id: TransitionId) -> Option<&TmTransition> {
        self.transitions.get(&id)
    }

    pub fn transitions(&self) -> impl Iterator<Item = (TransitionId, &TmTransition)> {
        self.transitions.iter().map(|(id, t)| (*id, t))
    }

    pub fn transitions_from(&self, state: StateId) -> impl Iterator<Item = (TransitionId, &TmTransition)> {
        self.transitions.iter().filter(move |(_, t)| t.from == state).map(|(id, t)| (*id, t))
    }

    /// Tape alphabet inferred from every symbol referenced by any
    /// transition's `read`/`write` — mirrors `PdaDoc::stack_alphabet`. The
    /// interned `blank_symbol()` is included only if some transition
    /// actually references it explicitly (same "inferred from usage, not
    /// declared" convention every other machine kind's alphabet uses).
    pub fn alphabet(&self) -> std::collections::BTreeSet<SymbolId> {
        self.transitions.values().flat_map(|t| t.tapes.iter().flat_map(|op| [op.read, op.write])).collect()
    }

    /// A conservative, edit-time-only nondeterminism flag for the UI — *not*
    /// a formal proof (real reachability of a given tape-content combination
    /// isn't simulated, same scope PDA's own version documents). Since reads
    /// are always exact atomic symbols (no wildcards, see this module's doc
    /// comment), two transitions from the same state can only ever both
    /// match the same live configuration when their `read` symbol is
    /// identical on *every* tape — so that's the whole conflict test.
    pub fn is_deterministic(&self) -> bool {
        let mut by_state: HashMap<StateId, Vec<&TmTransition>> = HashMap::new();
        for t in self.transitions.values() {
            by_state.entry(t.from).or_default().push(t);
        }
        for transitions in by_state.values() {
            for i in 0..transitions.len() {
                for j in (i + 1)..transitions.len() {
                    let a = &transitions[i].tapes;
                    let b = &transitions[j].tapes;
                    if a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.read == y.read) {
                        return false;
                    }
                }
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_document_has_no_states_zero_tape_count_and_is_deterministic() {
        let doc = TmDoc::new();
        assert_eq!(doc.states().count(), 0);
        assert_eq!(doc.tape_count(), 0);
        assert!(doc.is_deterministic());
    }

    #[test]
    fn blank_symbol_is_always_present_even_in_a_fresh_document() {
        let doc = TmDoc::new();
        assert_eq!(doc.symbol_label(doc.blank_symbol()), Some(BLANK));
    }

    #[test]
    fn a_fresh_state_is_not_accepting_until_set() {
        let mut doc = TmDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        assert!(!doc.is_accepting(q0));
        doc.set_accepting(q0, true);
        assert!(doc.is_accepting(q0));
    }

    #[test]
    fn tape_count_is_locked_in_by_the_first_transition_and_never_resets() {
        let mut doc = TmDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        let a = doc.intern_symbol("a");
        let id = doc
            .add_transition(q0, q1, vec![TmTapeOp { read: a, write: a, direction: Direction::Right }])
            .expect("first transition locks tape_count in");
        assert_eq!(doc.tape_count(), 1);

        doc.remove_transition(id);
        assert_eq!(doc.transitions().count(), 0);
        assert_eq!(doc.tape_count(), 1, "tape_count must stay locked even with zero live transitions");
    }

    #[test]
    fn a_transition_with_the_wrong_tape_count_is_rejected_as_a_no_op() {
        let mut doc = TmDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        let a = doc.intern_symbol("a");
        doc.add_transition(q0, q1, vec![TmTapeOp { read: a, write: a, direction: Direction::Right }]).unwrap();

        let rejected = doc.add_transition(
            q0,
            q1,
            vec![
                TmTapeOp { read: a, write: a, direction: Direction::Right },
                TmTapeOp { read: a, write: a, direction: Direction::Stay },
            ],
        );
        assert_eq!(rejected, None);
        assert_eq!(doc.transitions().count(), 1);
    }

    #[test]
    fn multiple_transitions_can_share_the_same_from_to_pair() {
        let mut doc = TmDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        let a = doc.intern_symbol("a");
        let b = doc.intern_symbol("b");
        let t1 = doc.add_transition(q0, q1, vec![TmTapeOp { read: a, write: b, direction: Direction::Right }]).unwrap();
        let t2 = doc.add_transition(q0, q1, vec![TmTapeOp { read: b, write: a, direction: Direction::Left }]).unwrap();
        assert_ne!(t1, t2);
        assert_eq!(doc.transitions_from(q0).count(), 2);
    }

    #[test]
    fn removing_a_state_cascades_its_incident_transitions_and_clears_initial() {
        let mut doc = TmDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        let a = doc.intern_symbol("a");
        doc.add_transition(q0, q1, vec![TmTapeOp { read: a, write: a, direction: Direction::Right }]).unwrap();
        doc.set_initial(Some(q0));

        doc.remove_state(q0);

        assert_eq!(doc.initial_state(), None);
        assert_eq!(doc.transitions().count(), 0);
        assert_eq!(doc.states().count(), 1);
    }

    #[test]
    fn restore_state_reconstructs_an_id_after_removal_same_as_pdadoc() {
        let mut doc = TmDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        doc.remove_state(q0);
        doc.restore_state(q0, "q0", 1.0, 2.0).unwrap();
        assert_eq!(doc.state_label(q0), Some("q0"));
        assert_eq!(doc.state_meta(q0), Some(&TmStateMeta { x: 1.0, y: 2.0, accepting: false }));
    }

    #[test]
    fn remove_transition_returns_it_and_edit_transition_replaces_payload_in_place() {
        let mut doc = TmDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        let a = doc.intern_symbol("a");
        let b = doc.intern_symbol("b");
        let id = doc.add_transition(q0, q1, vec![TmTapeOp { read: a, write: a, direction: Direction::Right }]).unwrap();

        assert!(doc.edit_transition(id, vec![TmTapeOp { read: b, write: b, direction: Direction::Left }]));
        assert_eq!(doc.transition(id).unwrap().tapes[0].read, b);

        let removed = doc.remove_transition(id).unwrap();
        assert_eq!(removed.tapes[0].read, b);
        assert_eq!(doc.transition(id), None);
    }

    #[test]
    fn two_transitions_from_the_same_state_with_identical_reads_on_every_tape_are_nondeterministic() {
        let mut doc = TmDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        let q2 = doc.add_state("q2", 10.0, 10.0).unwrap();
        let a = doc.intern_symbol("a");
        let b = doc.intern_symbol("b");
        doc.add_transition(q0, q1, vec![TmTapeOp { read: a, write: b, direction: Direction::Right }]).unwrap();
        doc.add_transition(q0, q2, vec![TmTapeOp { read: a, write: a, direction: Direction::Left }]).unwrap();
        assert!(!doc.is_deterministic());
    }

    #[test]
    fn distinct_reads_stay_deterministic() {
        let mut doc = TmDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        let q2 = doc.add_state("q2", 10.0, 10.0).unwrap();
        let a = doc.intern_symbol("a");
        let b = doc.intern_symbol("b");
        doc.add_transition(q0, q1, vec![TmTapeOp { read: a, write: a, direction: Direction::Right }]).unwrap();
        doc.add_transition(q0, q2, vec![TmTapeOp { read: b, write: b, direction: Direction::Left }]).unwrap();
        assert!(doc.is_deterministic());
    }

    #[test]
    fn two_tape_transition_conflict_requires_every_tape_to_match() {
        let mut doc = TmDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        let q2 = doc.add_state("q2", 10.0, 10.0).unwrap();
        let a = doc.intern_symbol("a");
        let b = doc.intern_symbol("b");
        doc.add_transition(
            q0,
            q1,
            vec![
                TmTapeOp { read: a, write: a, direction: Direction::Right },
                TmTapeOp { read: a, write: a, direction: Direction::Right },
            ],
        )
        .unwrap();
        // Same read on tape 0, different on tape 1: cannot both match the
        // same live two-tape configuration.
        doc.add_transition(
            q0,
            q2,
            vec![
                TmTapeOp { read: a, write: a, direction: Direction::Left },
                TmTapeOp { read: b, write: b, direction: Direction::Left },
            ],
        )
        .unwrap();
        assert!(doc.is_deterministic());
    }
}
