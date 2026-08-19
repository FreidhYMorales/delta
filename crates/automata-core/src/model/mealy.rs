//! Edit-facing Mealy-machine document (`MealyDoc`) — the first automaton
//! kind alongside `FaDoc`. Deliberately a **separate** model, not an
//! extension of `FaDoc`/`SymbolSet`: a Mealy transition pairs an input
//! symbol with an OUTPUT symbol (`q0 -[a/x]-> q1`), and the same
//! `(from, to)` pair can carry different outputs for different inputs — a
//! shape `SymbolSet` (one shared `epsilon` flag, no per-symbol payload)
//! can't represent without becoming a different, more complex type that
//! every already-tested FA consumer (jff interop, AFN→AFD, minimize,
//! regex/grammar conversions, undo history) would then have to account
//! for. Mirroring `FaDoc`'s shape and method names as closely as the actual
//! semantics allow instead keeps this a genuinely isolated addition — see
//! docs/decisions.md for the fuller "why not extend FaDoc" writeup.
//!
//! Differences from `FaDoc`, and why:
//!  - **No `accepting` flag.** Mealy output is produced per transition, not
//!    decided by reaching a final state — real JFLAP's `MealyMachine`
//!    inherits one from its `Automaton` base class but never reads it for
//!    Mealy's own semantics (`javap` on `automata.mealy.MealyMachine`/
//!    `MealyStepByStateSimulator` confirms nothing there consults
//!    accepting-ness). Carrying a field nothing meaningful ever reads would
//!    just be copying JFLAP's OOP-inheritance leftovers, not a real need.
//!  - **No epsilon transitions.** A Mealy transition is defined as reading
//!    exactly one input symbol and producing exactly one output symbol —
//!    an epsilon move would have nothing to pair an output with, breaking
//!    that invariant. Classic textbook Mealy machines don't have them.
//!  - **Two symbol arenas, not one.** Input and output alphabets are
//!    conceptually distinct (a machine reading digits could output
//!    letters) even when their label sets happen to overlap in practice,
//!    so each gets its own `Arena<SymbolId>` — reusing the exact same
//!    generic arena `FaDoc` uses for its one alphabet, just twice.
//!  - **Determinism is still derived, never declared** (same principle as
//!    `FaDoc::classify`), but Mealy's is boolean, not DFA/NFA: at most one
//!    transition per `(state, input symbol)` pair, full stop — no epsilon
//!    case to also account for.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use crate::ids::{Arena, ArenaError, StateId, SymbolId};

/// Per-state geometry only — see the module doc comment for why there's no
/// `accepting` flag here.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MealyStateMeta {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MealyDoc {
    states: Arena<StateId>,
    state_meta: HashMap<StateId, MealyStateMeta>,
    initial: Option<StateId>,
    input_symbols: Arena<SymbolId>,
    output_symbols: Arena<SymbolId>,
    /// input symbol -> output symbol, per `(from, to)` pair. A transition
    /// exists iff its input symbol is a key here.
    edges: HashMap<(StateId, StateId), BTreeMap<SymbolId, SymbolId>>,
}

impl Default for MealyDoc {
    fn default() -> Self {
        Self::new()
    }
}

impl MealyDoc {
    pub fn new() -> Self {
        MealyDoc {
            states: Arena::new(),
            state_meta: HashMap::new(),
            initial: None,
            input_symbols: Arena::new(),
            output_symbols: Arena::new(),
            edges: HashMap::new(),
        }
    }

    // -- states -----------------------------------------------------------

    pub fn add_state(&mut self, label: &str, x: f64, y: f64) -> Result<StateId, ArenaError> {
        let id = self.states.alloc(label)?;
        self.state_meta.insert(id, MealyStateMeta { x, y });
        Ok(id)
    }

    /// Reconstruct a previously-removed state at its exact original id —
    /// same undo-only role as `FaDoc::restore_state` (design D4).
    pub fn restore_state(&mut self, id: StateId, label: &str, x: f64, y: f64) -> Result<(), ArenaError> {
        self.states.alloc_at(id, label)?;
        self.state_meta.insert(id, MealyStateMeta { x, y });
        Ok(())
    }

    /// Remove a state, cascading removal of every incident edge and clearing
    /// `initial` if this was the initial state. No-op if `id` is not alive.
    pub fn remove_state(&mut self, id: StateId) {
        if !self.states.is_alive(id) {
            return;
        }
        self.states.free(id);
        self.state_meta.remove(&id);
        if self.initial == Some(id) {
            self.initial = None;
        }
        self.edges.retain(|(from, to), _| *from != id && *to != id);
    }

    pub fn states(&self) -> impl Iterator<Item = StateId> + '_ {
        self.states.iter_alive()
    }

    pub fn state_label(&self, id: StateId) -> Option<&str> {
        self.states.label(id)
    }

    pub fn state_meta(&self, id: StateId) -> Option<&MealyStateMeta> {
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

    // -- symbols ------------------------------------------------------------

    pub fn intern_input_symbol(&mut self, label: &str) -> SymbolId {
        intern(&mut self.input_symbols, label)
    }

    pub fn input_symbol_label(&self, id: SymbolId) -> Option<&str> {
        self.input_symbols.label(id)
    }

    pub fn input_symbol_label_to_id(&self, label: &str) -> Option<SymbolId> {
        self.input_symbols.id_for_label(label)
    }

    pub fn intern_output_symbol(&mut self, label: &str) -> SymbolId {
        intern(&mut self.output_symbols, label)
    }

    pub fn output_symbol_label(&self, id: SymbolId) -> Option<&str> {
        self.output_symbols.label(id)
    }

    pub fn output_symbol_label_to_id(&self, label: &str) -> Option<SymbolId> {
        self.output_symbols.id_for_label(label)
    }

    // -- edges ----------------------------------------------------------

    pub fn edge(&self, from: StateId, to: StateId) -> Option<&BTreeMap<SymbolId, SymbolId>> {
        self.edges.get(&(from, to))
    }

    pub fn edges(&self) -> impl Iterator<Item = (&(StateId, StateId), &BTreeMap<SymbolId, SymbolId>)> {
        self.edges.iter()
    }

    /// Replace the full input->output map of an edge. An empty map removes
    /// the edge entirely — same "empty set means gone" convention as
    /// `FaDoc::set_edge`.
    pub fn set_transitions(&mut self, from: StateId, to: StateId, transitions: BTreeMap<SymbolId, SymbolId>) {
        if transitions.is_empty() {
            self.edges.remove(&(from, to));
        } else {
            self.edges.insert((from, to), transitions);
        }
    }

    /// Convenience: add or overwrite a single `input -> output` pair on the
    /// `(from, to)` edge, interning both labels as needed.
    pub fn add_transition(&mut self, from: StateId, to: StateId, input: &str, output: &str) -> (SymbolId, SymbolId) {
        let input_id = self.intern_input_symbol(input);
        let output_id = self.intern_output_symbol(output);
        self.edges.entry((from, to)).or_default().insert(input_id, output_id);
        (input_id, output_id)
    }

    pub fn remove_edge(&mut self, from: StateId, to: StateId) {
        self.edges.remove(&(from, to));
    }

    /// Input alphabet inferred from the symbols actually used across all
    /// current edges (never explicitly declared) — mirrors `FaDoc::alphabet`.
    pub fn input_alphabet(&self) -> BTreeSet<SymbolId> {
        self.edges.values().flat_map(|t| t.keys().copied()).collect()
    }

    /// Output alphabet, same "inferred from usage" rule.
    pub fn output_alphabet(&self) -> BTreeSet<SymbolId> {
        self.edges.values().flat_map(|t| t.values().copied()).collect()
    }

    /// Deterministic iff no `(state, input symbol)` pair has more than one
    /// transition (to any target) — see the module doc comment for why
    /// there's no epsilon case to also check, unlike `FaDoc::classify`.
    pub fn is_deterministic(&self) -> bool {
        let mut seen_by_from: HashMap<StateId, HashSet<SymbolId>> = HashMap::new();
        for ((from, _to), transitions) in &self.edges {
            let seen = seen_by_from.entry(*from).or_default();
            for &input in transitions.keys() {
                if !seen.insert(input) {
                    return false;
                }
            }
        }
        true
    }
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
        let doc = MealyDoc::new();
        assert_eq!(doc.states().count(), 0);
        assert!(doc.is_deterministic());
    }

    #[test]
    fn a_transition_interns_both_alphabets_independently() {
        let mut doc = MealyDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        doc.add_transition(q0, q1, "0", "x");
        assert_eq!(doc.input_symbol_label_to_id("0"), Some(SymbolId(0)));
        assert_eq!(doc.output_symbol_label_to_id("x"), Some(SymbolId(0)));
        // Same label "0" on the input side never collides with the output
        // side's own independent arena.
        doc.add_transition(q0, q1, "1", "0");
        assert_eq!(doc.output_symbol_label_to_id("0"), Some(SymbolId(1)));
    }

    #[test]
    fn the_same_from_to_pair_can_map_different_inputs_to_different_outputs() {
        let mut doc = MealyDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        doc.add_transition(q0, q1, "a", "x");
        doc.add_transition(q0, q1, "b", "y");
        let edge = doc.edge(q0, q1).unwrap();
        assert_eq!(edge.len(), 2);
        assert!(doc.is_deterministic());
    }

    #[test]
    fn two_transitions_from_the_same_state_on_the_same_input_are_nondeterministic() {
        let mut doc = MealyDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        let q2 = doc.add_state("q2", 10.0, 10.0).unwrap();
        doc.add_transition(q0, q1, "a", "x");
        doc.add_transition(q0, q2, "a", "y");
        assert!(!doc.is_deterministic());
    }

    #[test]
    fn removing_a_state_cascades_its_incident_edges_and_clears_initial() {
        let mut doc = MealyDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        doc.add_transition(q0, q1, "a", "x");
        doc.set_initial(Some(q0));

        doc.remove_state(q0);

        assert_eq!(doc.initial_state(), None);
        assert_eq!(doc.edge(q0, q1), None);
        assert_eq!(doc.states().count(), 1);
    }

    #[test]
    fn restore_state_reconstructs_an_id_after_removal_same_as_fadoc() {
        let mut doc = MealyDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        doc.remove_state(q0);
        doc.restore_state(q0, "q0", 1.0, 2.0).unwrap();
        assert_eq!(doc.state_label(q0), Some("q0"));
        assert_eq!(doc.state_meta(q0), Some(&MealyStateMeta { x: 1.0, y: 2.0 }));
    }

    #[test]
    fn set_transitions_with_an_empty_map_removes_the_edge() {
        let mut doc = MealyDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        doc.add_transition(q0, q1, "a", "x");
        doc.set_transitions(q0, q1, BTreeMap::new());
        assert_eq!(doc.edge(q0, q1), None);
    }
}
