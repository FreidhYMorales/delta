//! Edit-facing Pushdown Automaton document (`PdaDoc`) — a new, isolated
//! model, following the same "isolate when shapes differ" principle the
//! Mealy/Moore backends established (see docs/decisions.md's "Máquina de
//! Mealy: backend completo, aislado de FaDoc (opción B)" and the Moore
//! backend entry).
//!
//! Ground truth verified by decompiling real JFLAP's
//! `automata.pda.{PDATransition,PushdownAutomaton,PDAConfiguration,
//! PDAStepByStateSimulator,PDAStepWithClosureSimulator,CharacterStack}`
//! with `cfr`:
//!  - `PushdownAutomaton extends Automaton` directly — a PDA **does** have
//!    accepting states, unlike Mealy/Moore.
//!  - Each transition carries three fields: an input symbol (empty string =
//!    epsilon, matches regardless of remaining input), a string to pop off
//!    the stack top (empty = pop nothing), and a string to push (empty =
//!    push nothing). A transition fires iff the input matches and the top
//!    of the stack equals the pop string exactly.
//!  - **Transitions are individually addressable**, not one payload per
//!    `(from, to)` edge like FA/Mealy/Moore: several transitions can share
//!    the same `(from, to)` with different `(input, pop, push)` triples, or
//!    even the same `(from, input, pop)` can branch to different
//!    `(to, push)`. Each gets its own [`TransitionId`], a plain monotonic
//!    counter owned by `PdaDoc` — no name-based lookup is ever needed for a
//!    transition, so it isn't `Arena`-allocated like states/symbols are.
//!  - `CharacterStack.push(String s)` does `buffer.insert(0, s)`: the pushed
//!    string lands at the top *as a whole*, left-to-right. `pop(n)` removes
//!    the top `n` characters, top-to-bottom. So both `pop` and `push` here
//!    are stored **top-to-bottom order** — `pop[0]`/`push[0]` is always the
//!    element closest to (or ending up as) the stack top — exactly
//!    mirroring JFLAP's own string convention, just as a `Vec<SymbolId>`
//!    instead of a raw string. See `engine::pda` for how this order gets
//!    translated against the runtime stack representation.
//!  - The stack always starts with exactly one fixed bottom-marker symbol
//!    pushed before simulation begins (JFLAP hardcodes `"Z"`) — not
//!    user-configurable, not stored on the document at all. Handled entirely
//!    in `engine::pda`, not here.
//!  - Accept mode (final state vs. empty stack) is a **simulation-time**
//!    choice, never stored on the document — same reasoning, handled in
//!    `engine::pda`.
//!
//! Two `Arena<SymbolId>` — `input_symbols`, `stack_symbols` — same
//! "conceptually distinct alphabets" reasoning as Mealy/Moore's
//! input/output arenas.

use std::collections::{BTreeSet, HashMap};

use crate::ids::{Arena, ArenaError, StateId, SymbolId};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PdaStateMeta {
    pub x: f64,
    pub y: f64,
    pub accepting: bool,
}

/// Opaque id for one transition rule. See the module doc comment for why
/// this isn't arena-allocated: a plain monotonic counter (owned by
/// `PdaDoc::next_transition_id`), never reused after a transition is
/// removed (unlike `StateId`/`SymbolId`, nothing needs the freed slot back
/// — there's no dense-index perf requirement for transitions, and reusing a
/// freed id right after removal risks colliding with a still-referenced
/// stale id from edit history).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct TransitionId(pub u32);

#[derive(Debug, Clone, PartialEq)]
pub struct PdaTransition {
    pub from: StateId,
    pub to: StateId,
    /// `None` = epsilon/lambda (fires regardless of remaining input).
    pub input: Option<SymbolId>,
    /// Required stack-top symbols, **top-to-bottom order** — see the module
    /// doc comment. Empty = pop nothing.
    pub pop: Vec<SymbolId>,
    /// Symbols to push, **top-to-bottom order** (`push[0]` ends up as the
    /// new stack top) — see the module doc comment. Empty = push nothing.
    pub push: Vec<SymbolId>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PdaDoc {
    states: Arena<StateId>,
    state_meta: HashMap<StateId, PdaStateMeta>,
    initial: Option<StateId>,
    input_symbols: Arena<SymbolId>,
    stack_symbols: Arena<SymbolId>,
    transitions: HashMap<TransitionId, PdaTransition>,
    next_transition_id: u32,
}

impl Default for PdaDoc {
    fn default() -> Self {
        Self::new()
    }
}

impl PdaDoc {
    pub fn new() -> Self {
        PdaDoc {
            states: Arena::new(),
            state_meta: HashMap::new(),
            initial: None,
            input_symbols: Arena::new(),
            stack_symbols: Arena::new(),
            transitions: HashMap::new(),
            next_transition_id: 0,
        }
    }

    // -- states -------------------------------------------------------------

    pub fn add_state(&mut self, label: &str, x: f64, y: f64) -> Result<StateId, ArenaError> {
        let id = self.states.alloc(label)?;
        self.state_meta.insert(id, PdaStateMeta { x, y, accepting: false });
        Ok(id)
    }

    /// Reconstruct a previously-removed state at its exact original id —
    /// same undo-only role as `MooreDoc::restore_state`. `accepting` starts
    /// `false` here too; `PdaEditOp::RemoveState` restores a prior `true`
    /// via a follow-up `SetAccepting` in its inverse transaction, same
    /// pattern Moore uses for a prior non-empty output.
    pub fn restore_state(&mut self, id: StateId, label: &str, x: f64, y: f64) -> Result<(), ArenaError> {
        self.states.alloc_at(id, label)?;
        self.state_meta.insert(id, PdaStateMeta { x, y, accepting: false });
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

    pub fn state_meta(&self, id: StateId) -> Option<&PdaStateMeta> {
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

    pub fn intern_input_symbol(&mut self, label: &str) -> SymbolId {
        intern(&mut self.input_symbols, label)
    }

    pub fn input_symbol_label(&self, id: SymbolId) -> Option<&str> {
        self.input_symbols.label(id)
    }

    pub fn input_symbol_label_to_id(&self, label: &str) -> Option<SymbolId> {
        self.input_symbols.id_for_label(label)
    }

    pub fn intern_stack_symbol(&mut self, label: &str) -> SymbolId {
        intern(&mut self.stack_symbols, label)
    }

    pub fn stack_symbol_label(&self, id: SymbolId) -> Option<&str> {
        self.stack_symbols.label(id)
    }

    pub fn stack_symbol_label_to_id(&self, label: &str) -> Option<SymbolId> {
        self.stack_symbols.id_for_label(label)
    }

    // -- transitions ----------------------------------------------------------

    /// Allocate a new transition and return its fresh id.
    pub fn add_transition(
        &mut self,
        from: StateId,
        to: StateId,
        input: Option<SymbolId>,
        pop: Vec<SymbolId>,
        push: Vec<SymbolId>,
    ) -> TransitionId {
        let id = TransitionId(self.next_transition_id);
        self.next_transition_id += 1;
        self.transitions.insert(id, PdaTransition { from, to, input, pop, push });
        id
    }

    /// Reinsert a transition at a specific, previously-removed id —
    /// undo-only, same role as `restore_state`. Does not touch
    /// `next_transition_id` — that counter only governs *new* allocations
    /// via `add_transition`, so a subsequent add still gets a fresh id.
    pub fn restore_transition(&mut self, id: TransitionId, transition: PdaTransition) {
        self.transitions.insert(id, transition);
    }

    pub fn remove_transition(&mut self, id: TransitionId) -> Option<PdaTransition> {
        self.transitions.remove(&id)
    }

    /// Replace an existing transition's `(input, pop, push)` payload in
    /// place, keeping its id and endpoints. No-op (returns `false`) if `id`
    /// doesn't exist.
    pub fn edit_transition(&mut self, id: TransitionId, input: Option<SymbolId>, pop: Vec<SymbolId>, push: Vec<SymbolId>) -> bool {
        let Some(t) = self.transitions.get_mut(&id) else {
            return false;
        };
        t.input = input;
        t.pop = pop;
        t.push = push;
        true
    }

    pub fn transition(&self, id: TransitionId) -> Option<&PdaTransition> {
        self.transitions.get(&id)
    }

    pub fn transitions(&self) -> impl Iterator<Item = (TransitionId, &PdaTransition)> {
        self.transitions.iter().map(|(id, t)| (*id, t))
    }

    pub fn transitions_from(&self, state: StateId) -> impl Iterator<Item = (TransitionId, &PdaTransition)> {
        self.transitions.iter().filter(move |(_, t)| t.from == state).map(|(id, t)| (*id, t))
    }

    /// Input alphabet inferred from the symbols actually referenced by a
    /// transition (never explicitly declared) — mirrors
    /// `MealyDoc::input_alphabet`/`MooreDoc::input_alphabet`.
    pub fn input_alphabet(&self) -> BTreeSet<SymbolId> {
        self.transitions.values().filter_map(|t| t.input).collect()
    }

    /// Stack alphabet inferred from every symbol referenced in any
    /// transition's `pop` or `push`.
    pub fn stack_alphabet(&self) -> BTreeSet<SymbolId> {
        self.transitions.values().flat_map(|t| t.pop.iter().chain(t.push.iter()).copied()).collect()
    }

    /// A conservative, edit-time-only nondeterminism flag for the UI — *not*
    /// a formal PDA determinism proof (that also depends on which stack
    /// contents are actually reachable at runtime, which this doesn't
    /// simulate). Flags two transitions from the same state as conflicting
    /// when their `input`s could both apply (either is epsilon, or they're
    /// the same symbol) *and* their `pop` requirements are compatible (one
    /// is a prefix of the other, so a stack that satisfies the longer one
    /// necessarily also satisfies the shorter) — i.e. both could plausibly
    /// fire on the same real input/stack combination.
    pub fn is_deterministic(&self) -> bool {
        let mut by_state: HashMap<StateId, Vec<&PdaTransition>> = HashMap::new();
        for t in self.transitions.values() {
            by_state.entry(t.from).or_default().push(t);
        }
        for transitions in by_state.values() {
            for i in 0..transitions.len() {
                for j in (i + 1)..transitions.len() {
                    let a = transitions[i];
                    let b = transitions[j];
                    let input_conflict = a.input.is_none() || b.input.is_none() || a.input == b.input;
                    let pop_conflict = is_prefix(&a.pop, &b.pop) || is_prefix(&b.pop, &a.pop);
                    if input_conflict && pop_conflict {
                        return false;
                    }
                }
            }
        }
        true
    }
}

fn is_prefix(shorter_or_equal: &[SymbolId], other: &[SymbolId]) -> bool {
    shorter_or_equal.len() <= other.len() && shorter_or_equal.iter().zip(other).all(|(a, b)| a == b)
}

fn intern(arena: &mut Arena<SymbolId>, label: &str) -> SymbolId {
    if let Some(id) = arena.id_for_label(label) {
        return id;
    }
    arena.alloc(label).expect("label just checked absent from label_index")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_document_has_no_states_and_is_deterministic() {
        let doc = PdaDoc::new();
        assert_eq!(doc.states().count(), 0);
        assert!(doc.is_deterministic());
    }

    #[test]
    fn a_fresh_state_is_not_accepting_until_set() {
        let mut doc = PdaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        assert!(!doc.is_accepting(q0));
        doc.set_accepting(q0, true);
        assert!(doc.is_accepting(q0));
    }

    #[test]
    fn input_and_stack_alphabets_are_independent_arenas() {
        let mut doc = PdaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        let a = doc.intern_input_symbol("a");
        let z = doc.intern_stack_symbol("a"); // same label "a" on the stack side
        doc.add_transition(q0, q1, Some(a), vec![], vec![z]);
        assert_eq!(doc.input_symbol_label_to_id("a"), Some(SymbolId(0)));
        assert_eq!(doc.stack_symbol_label_to_id("a"), Some(SymbolId(0)));
        // Independent arenas: same numeric id, different alphabets, no collision.
        assert_eq!(doc.input_alphabet().len(), 1);
        assert_eq!(doc.stack_alphabet().len(), 1);
    }

    #[test]
    fn multiple_transitions_can_share_the_same_from_to_pair() {
        let mut doc = PdaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        let a = doc.intern_input_symbol("a");
        let b = doc.intern_input_symbol("b");
        let t1 = doc.add_transition(q0, q1, Some(a), vec![], vec![]);
        let t2 = doc.add_transition(q0, q1, Some(b), vec![], vec![]);
        assert_ne!(t1, t2);
        assert_eq!(doc.transitions_from(q0).count(), 2);
    }

    #[test]
    fn epsilon_transition_has_no_input_symbol() {
        let mut doc = PdaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        let id = doc.add_transition(q0, q1, None, vec![], vec![]);
        assert_eq!(doc.transition(id).unwrap().input, None);
    }

    #[test]
    fn removing_a_state_cascades_its_incident_transitions_and_clears_initial() {
        let mut doc = PdaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        let a = doc.intern_input_symbol("a");
        doc.add_transition(q0, q1, Some(a), vec![], vec![]);
        doc.set_initial(Some(q0));

        doc.remove_state(q0);

        assert_eq!(doc.initial_state(), None);
        assert_eq!(doc.transitions().count(), 0);
        assert_eq!(doc.states().count(), 1);
    }

    #[test]
    fn restore_state_reconstructs_an_id_after_removal_same_as_mooredoc() {
        let mut doc = PdaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        doc.remove_state(q0);
        doc.restore_state(q0, "q0", 1.0, 2.0).unwrap();
        assert_eq!(doc.state_label(q0), Some("q0"));
        assert_eq!(doc.state_meta(q0), Some(&PdaStateMeta { x: 1.0, y: 2.0, accepting: false }));
    }

    #[test]
    fn remove_transition_returns_it_and_edit_transition_replaces_payload_in_place() {
        let mut doc = PdaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        let a = doc.intern_input_symbol("a");
        let b = doc.intern_input_symbol("b");
        let id = doc.add_transition(q0, q1, Some(a), vec![], vec![]);

        assert!(doc.edit_transition(id, Some(b), vec![], vec![]));
        assert_eq!(doc.transition(id).unwrap().input, Some(b));

        let removed = doc.remove_transition(id).unwrap();
        assert_eq!(removed.input, Some(b));
        assert_eq!(doc.transition(id), None);
    }

    #[test]
    fn two_transitions_from_the_same_state_with_the_same_input_and_compatible_pop_are_nondeterministic() {
        let mut doc = PdaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        let q2 = doc.add_state("q2", 10.0, 10.0).unwrap();
        let a = doc.intern_input_symbol("a");
        doc.add_transition(q0, q1, Some(a), vec![], vec![]);
        doc.add_transition(q0, q2, Some(a), vec![], vec![]);
        assert!(!doc.is_deterministic());
    }

    #[test]
    fn distinct_pop_requirements_that_share_no_prefix_stay_deterministic() {
        let mut doc = PdaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        let q2 = doc.add_state("q2", 10.0, 10.0).unwrap();
        let a = doc.intern_input_symbol("a");
        let x = doc.intern_stack_symbol("x");
        let y = doc.intern_stack_symbol("y");
        doc.add_transition(q0, q1, Some(a), vec![x], vec![]);
        doc.add_transition(q0, q2, Some(a), vec![y], vec![]);
        assert!(doc.is_deterministic());
    }

    #[test]
    fn an_epsilon_transition_conflicts_with_any_other_transition_from_the_same_state() {
        let mut doc = PdaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        let q2 = doc.add_state("q2", 10.0, 10.0).unwrap();
        let a = doc.intern_input_symbol("a");
        doc.add_transition(q0, q1, None, vec![], vec![]);
        doc.add_transition(q0, q2, Some(a), vec![], vec![]);
        assert!(!doc.is_deterministic());
    }
}
