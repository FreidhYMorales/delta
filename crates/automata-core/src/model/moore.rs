//! Edit-facing Moore-machine document (`MooreDoc`) — a genuinely separate
//! model from both `FaDoc` and `MealyDoc`, following the same "isolate when
//! shapes differ" principle the Mealy backend established (see
//! docs/decisions.md's "Máquina de Mealy: backend completo, aislado de
//! FaDoc (opción B)" entry for the fuller reasoning).
//!
//! Ground truth verified by decompiling real JFLAP's
//! `automata.mealy.{MooreMachine,MooreTransition,MooreStepByStateSimulator}`
//! with `cfr`: a Moore machine's output is attached to **states**, not
//! transitions (`MooreMachine` holds a `Map<State, String>`); a
//! `MooreTransition extends MealyTransition` but its `getOutput()`/
//! `setOutput()` just delegate to the destination state's output — the
//! transition itself carries no output of its own, only an input label.
//! That's why `MooreDoc`'s edge shape is much closer to a plain DFA edge set
//! than to `MealyDoc`'s per-symbol `input -> output` map.
//!
//! Differences from `MealyDoc`, and why:
//!  - **Output lives on `MooreStateMeta`, not on edges.** `edges` is a plain
//!    `HashMap<(StateId, StateId), BTreeSet<SymbolId>>` of input symbols —
//!    there is no per-symbol output to pair each one with.
//!  - **No `accepting` flag**, same reasoning as `MealyDoc`: nothing in real
//!    JFLAP's Moore semantics ever reads it, it would just be an OOP
//!    inheritance leftover.
//!  - **No epsilon transitions**, same reasoning as `MealyDoc`: this is a
//!    transducer, kept deterministic-by-convention like Mealy for the same
//!    simplifying default.
//!  - **Two symbol arenas**, same reasoning as `MealyDoc`: input and output
//!    alphabets are conceptually distinct, even if their labels sometimes
//!    overlap in practice.

use std::collections::{BTreeSet, HashMap, HashSet};

use crate::ids::{Arena, ArenaError, StateId, SymbolId};

/// Per-state geometry plus this state's Moore output — see the module doc
/// comment for why output lives here instead of on edges, and why there's
/// no `accepting` flag.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MooreStateMeta {
    pub x: f64,
    pub y: f64,
    /// `None` = unset (JFLAP's implicit `""` default, represented as an
    /// idiomatic `Option` instead of a sentinel empty string).
    pub output: Option<SymbolId>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MooreDoc {
    states: Arena<StateId>,
    state_meta: HashMap<StateId, MooreStateMeta>,
    initial: Option<StateId>,
    input_symbols: Arena<SymbolId>,
    output_symbols: Arena<SymbolId>,
    /// Input symbols that trigger a `(from, to)` transition. A transition
    /// exists iff its input symbol is a member of this set.
    edges: HashMap<(StateId, StateId), BTreeSet<SymbolId>>,
}

impl Default for MooreDoc {
    fn default() -> Self {
        Self::new()
    }
}

impl MooreDoc {
    pub fn new() -> Self {
        MooreDoc {
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
        self.state_meta.insert(id, MooreStateMeta { x, y, output: None });
        Ok(id)
    }

    /// Reconstruct a previously-removed state at its exact original id —
    /// same undo-only role as `FaDoc::restore_state`/`MealyDoc::restore_state`
    /// (design D4). Output starts unset here too; `MooreEditOp::RemoveState`
    /// restores a non-empty prior output via a follow-up `SetOutput` in its
    /// inverse transaction, same pattern used for incident edges.
    pub fn restore_state(&mut self, id: StateId, label: &str, x: f64, y: f64) -> Result<(), ArenaError> {
        self.states.alloc_at(id, label)?;
        self.state_meta.insert(id, MooreStateMeta { x, y, output: None });
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

    pub fn state_meta(&self, id: StateId) -> Option<&MooreStateMeta> {
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

    /// This state's output, or `None` if unset. No-op (returns `None`) if
    /// `id` is not alive.
    pub fn output(&self, id: StateId) -> Option<SymbolId> {
        self.state_meta.get(&id)?.output
    }

    pub fn set_output(&mut self, id: StateId, output: Option<SymbolId>) {
        if let Some(meta) = self.state_meta.get_mut(&id) {
            meta.output = output;
        }
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

    pub fn edge(&self, from: StateId, to: StateId) -> Option<&BTreeSet<SymbolId>> {
        self.edges.get(&(from, to))
    }

    pub fn edges(&self) -> impl Iterator<Item = (&(StateId, StateId), &BTreeSet<SymbolId>)> {
        self.edges.iter()
    }

    /// Replace the full input-symbol set of an edge. An empty set removes
    /// the edge entirely — same "empty set means gone" convention as
    /// `FaDoc::set_edge`/`MealyDoc::set_transitions`.
    pub fn set_transitions(&mut self, from: StateId, to: StateId, inputs: BTreeSet<SymbolId>) {
        if inputs.is_empty() {
            self.edges.remove(&(from, to));
        } else {
            self.edges.insert((from, to), inputs);
        }
    }

    /// Convenience: add a single input symbol to the `(from, to)` edge,
    /// interning the label as needed.
    pub fn add_transition(&mut self, from: StateId, to: StateId, input: &str) -> SymbolId {
        let input_id = self.intern_input_symbol(input);
        self.edges.entry((from, to)).or_default().insert(input_id);
        input_id
    }

    pub fn remove_edge(&mut self, from: StateId, to: StateId) {
        self.edges.remove(&(from, to));
    }

    /// Input alphabet inferred from the symbols actually used across all
    /// current edges (never explicitly declared) — mirrors `MealyDoc::input_alphabet`.
    pub fn input_alphabet(&self) -> BTreeSet<SymbolId> {
        self.edges.values().flat_map(|s| s.iter().copied()).collect()
    }

    /// Output alphabet, inferred from the symbols actually assigned to a
    /// state — not from edges (Moore has no per-edge output).
    pub fn output_alphabet(&self) -> BTreeSet<SymbolId> {
        self.state_meta.values().filter_map(|m| m.output).collect()
    }

    /// Deterministic iff no `(state, input symbol)` pair has more than one
    /// outgoing transition (to any target) — same rule as
    /// `MealyDoc::is_deterministic`, just over a symbol set instead of a map.
    pub fn is_deterministic(&self) -> bool {
        let mut seen_by_from: HashMap<StateId, HashSet<SymbolId>> = HashMap::new();
        for ((from, _to), inputs) in &self.edges {
            let seen = seen_by_from.entry(*from).or_default();
            for &input in inputs {
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
        let doc = MooreDoc::new();
        assert_eq!(doc.states().count(), 0);
        assert!(doc.is_deterministic());
    }

    #[test]
    fn a_fresh_state_has_no_output_until_set() {
        let mut doc = MooreDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        assert_eq!(doc.output(q0), None);
        let even = doc.intern_output_symbol("even");
        doc.set_output(q0, Some(even));
        assert_eq!(doc.output(q0), Some(even));
    }

    #[test]
    fn input_and_output_alphabets_are_independent_arenas() {
        let mut doc = MooreDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        doc.add_transition(q0, q1, "0");
        let out = doc.intern_output_symbol("0"); // same label "0" on the output side
        doc.set_output(q1, Some(out));
        assert_eq!(doc.input_symbol_label_to_id("0"), Some(SymbolId(0)));
        assert_eq!(doc.output_symbol_label_to_id("0"), Some(SymbolId(0)));
        // Independent arenas: same numeric id, different alphabets, no collision.
        assert_eq!(doc.input_alphabet().len(), 1);
        assert_eq!(doc.output_alphabet().len(), 1);
    }

    #[test]
    fn an_edge_can_carry_multiple_input_symbols() {
        let mut doc = MooreDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        doc.add_transition(q0, q1, "a");
        doc.add_transition(q0, q1, "b");
        let edge = doc.edge(q0, q1).unwrap();
        assert_eq!(edge.len(), 2);
        assert!(doc.is_deterministic());
    }

    #[test]
    fn two_transitions_from_the_same_state_on_the_same_input_are_nondeterministic() {
        let mut doc = MooreDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        let q2 = doc.add_state("q2", 10.0, 10.0).unwrap();
        doc.add_transition(q0, q1, "a");
        doc.add_transition(q0, q2, "a");
        assert!(!doc.is_deterministic());
    }

    #[test]
    fn removing_a_state_cascades_its_incident_edges_and_clears_initial() {
        let mut doc = MooreDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        doc.add_transition(q0, q1, "a");
        doc.set_initial(Some(q0));

        doc.remove_state(q0);

        assert_eq!(doc.initial_state(), None);
        assert_eq!(doc.edge(q0, q1), None);
        assert_eq!(doc.states().count(), 1);
    }

    #[test]
    fn restore_state_reconstructs_an_id_after_removal_same_as_mealydoc() {
        let mut doc = MooreDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        doc.remove_state(q0);
        doc.restore_state(q0, "q0", 1.0, 2.0).unwrap();
        assert_eq!(doc.state_label(q0), Some("q0"));
        assert_eq!(doc.state_meta(q0), Some(&MooreStateMeta { x: 1.0, y: 2.0, output: None }));
    }

    #[test]
    fn set_transitions_with_an_empty_set_removes_the_edge() {
        let mut doc = MooreDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        doc.add_transition(q0, q1, "a");
        doc.set_transitions(q0, q1, BTreeSet::new());
        assert_eq!(doc.edge(q0, q1), None);
    }
}
