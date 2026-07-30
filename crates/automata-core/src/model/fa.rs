//! Edit-facing finite-automaton document (`FaDoc`).
//!
//! `FaDoc` is the name-stable, undoable representation edited by the
//! diagram/table/formal-definition views. It is deliberately dumb: it has no
//! opinion about undo (see `doc::history`) and no opinion about fast
//! simulation (see `engine::fa`); it only stores states, geometry, flags and
//! the pair-grouped transition edges, and derives the alphabet and
//! DFA/NFA classification from them.

use std::collections::{BTreeSet, HashMap, HashSet};

use crate::ids::{Arena, ArenaError, SymbolId, StateId};

/// Per-state geometry and flags. `initial` is tracked separately on
/// [`FaDoc`] (at most one state is initial at a time), so it is not
/// duplicated here.
#[derive(Debug, Clone, PartialEq)]
pub struct StateMeta {
    pub x: f64,
    pub y: f64,
    pub accepting: bool,
}

/// The set of symbols labeling a single (from, to) edge, plus whether that
/// edge also carries an epsilon move. Grouping by pair (rather than by
/// individual symbol) matches the diagram's "one arrow, many symbols" UX.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SymbolSet {
    pub epsilon: bool,
    pub symbols: BTreeSet<SymbolId>,
}

impl SymbolSet {
    pub fn is_empty(&self) -> bool {
        !self.epsilon && self.symbols.is_empty()
    }
}

/// Automatic DFA/NFA classification, derived from transition structure only.
/// Never declared by the user — see spec "Determinism Is Derived".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Classification {
    Dfa,
    Nfa,
}

/// Edit-facing finite automaton: states, geometry/flags, exactly-zero-or-one
/// initial state, pair-grouped transitions, and an inferred alphabet.
#[derive(Debug, Clone, PartialEq)]
pub struct FaDoc {
    states: Arena<StateId>,
    state_meta: HashMap<StateId, StateMeta>,
    initial: Option<StateId>,
    symbols: Arena<SymbolId>,
    edges: HashMap<(StateId, StateId), SymbolSet>,
}

impl Default for FaDoc {
    fn default() -> Self {
        Self::new()
    }
}

impl FaDoc {
    pub fn new() -> Self {
        FaDoc {
            states: Arena::new(),
            state_meta: HashMap::new(),
            initial: None,
            symbols: Arena::new(),
            edges: HashMap::new(),
        }
    }

    // -- states -----------------------------------------------------------

    pub fn add_state(&mut self, label: &str, x: f64, y: f64) -> Result<StateId, ArenaError> {
        let id = self.states.alloc(label)?;
        self.state_meta.insert(id, StateMeta { x, y, accepting: false });
        Ok(id)
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

    pub fn state_meta(&self, id: StateId) -> Option<&StateMeta> {
        self.state_meta.get(&id)
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

    pub fn set_accepting(&mut self, id: StateId, accepting: bool) {
        if let Some(meta) = self.state_meta.get_mut(&id) {
            meta.accepting = accepting;
        }
    }

    pub fn is_accepting(&self, id: StateId) -> bool {
        self.state_meta.get(&id).is_some_and(|m| m.accepting)
    }

    /// Set the initial state, clearing any previously-initial state. `None`
    /// clears the initial state entirely (the empty-automaton case).
    pub fn set_initial(&mut self, id: Option<StateId>) {
        self.initial = id;
    }

    pub fn initial_state(&self) -> Option<StateId> {
        self.initial
    }

    // -- symbols ------------------------------------------------------------

    /// Intern a symbol label, reusing the existing id if already known.
    pub fn intern_symbol(&mut self, label: &str) -> SymbolId {
        if let Some(id) = self.symbols.id_for_label(label) {
            return id;
        }
        self.symbols
            .alloc(label)
            .expect("label just checked absent from label_index")
    }

    pub fn symbol_label(&self, id: SymbolId) -> Option<&str> {
        self.symbols.label(id)
    }

    // -- edges ----------------------------------------------------------

    pub fn edge(&self, from: StateId, to: StateId) -> Option<&SymbolSet> {
        self.edges.get(&(from, to))
    }

    pub fn edges(&self) -> impl Iterator<Item = (&(StateId, StateId), &SymbolSet)> {
        self.edges.iter()
    }

    /// Replace the full symbol set of an edge. An empty, non-epsilon set
    /// removes the edge entirely.
    pub fn set_edge(&mut self, from: StateId, to: StateId, set: SymbolSet) {
        if set.is_empty() {
            self.edges.remove(&(from, to));
        } else {
            self.edges.insert((from, to), set);
        }
    }

    /// Convenience: add a single symbol to the (from, to) edge, creating or
    /// extending it and interning the symbol label as needed.
    pub fn add_transition(&mut self, from: StateId, to: StateId, symbol: &str) -> SymbolId {
        let sym_id = self.intern_symbol(symbol);
        self.edges
            .entry((from, to))
            .or_default()
            .symbols
            .insert(sym_id);
        sym_id
    }

    pub fn add_epsilon_transition(&mut self, from: StateId, to: StateId) {
        self.edges.entry((from, to)).or_default().epsilon = true;
    }

    pub fn remove_edge(&mut self, from: StateId, to: StateId) {
        self.edges.remove(&(from, to));
    }

    /// Alphabet inferred from the symbols actually used across all current
    /// edges (never explicitly declared).
    pub fn alphabet(&self) -> BTreeSet<SymbolId> {
        self.edges
            .values()
            .flat_map(|set| set.symbols.iter().copied())
            .collect()
    }

    /// DFA iff there are no epsilon transitions and no (state, symbol) pair
    /// has more than one target; NFA otherwise.
    pub fn classify(&self) -> Classification {
        for set in self.edges.values() {
            if set.epsilon {
                return Classification::Nfa;
            }
        }
        let mut seen_by_from: HashMap<StateId, HashSet<SymbolId>> = HashMap::new();
        for ((from, _to), set) in &self.edges {
            let seen = seen_by_from.entry(*from).or_default();
            for sym in &set.symbols {
                if !seen.insert(*sym) {
                    return Classification::Nfa;
                }
            }
        }
        Classification::Dfa
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_automaton_is_valid() {
        let doc = FaDoc::new();
        assert_eq!(doc.states().count(), 0);
        assert!(doc.alphabet().is_empty());
        assert_eq!(doc.initial_state(), None);
    }

    #[test]
    fn adding_a_transition_extends_inferred_alphabet() {
        let mut doc = FaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        doc.add_transition(q0, q1, "a");
        let alpha_before: Vec<_> = doc
            .alphabet()
            .iter()
            .map(|id| doc.symbol_label(*id).unwrap().to_string())
            .collect();
        assert_eq!(alpha_before, vec!["a"]);

        doc.add_transition(q1, q0, "b");
        let mut alpha_after: Vec<_> = doc
            .alphabet()
            .iter()
            .map(|id| doc.symbol_label(*id).unwrap().to_string())
            .collect();
        alpha_after.sort();
        assert_eq!(alpha_after, vec!["a", "b"]);
    }

    #[test]
    fn remove_state_cascades_incident_edges_and_clears_initial() {
        let mut doc = FaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        doc.add_transition(q0, q1, "a");
        doc.set_initial(Some(q0));

        doc.remove_state(q0);

        assert!(!doc.states().any(|s| s == q0));
        assert_eq!(doc.edge(q0, q1), None);
        assert_eq!(doc.initial_state(), None);
        assert!(doc.states().any(|s| s == q1));
    }

    #[test]
    fn rename_state_blocks_collision() {
        let mut doc = FaDoc::new();
        let a = doc.add_state("A", 0.0, 0.0).unwrap();
        let b = doc.add_state("B", 0.0, 0.0).unwrap();
        assert!(doc.rename_state(a, "B").is_err());
        assert_eq!(doc.state_label(a), Some("A"));
        assert!(doc.rename_state(b, "B2").is_ok());
        assert_eq!(doc.state_label(b), Some("B2"));
    }

    #[test]
    fn dfa_classification_no_eps_and_deterministic() {
        let mut doc = FaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 0.0, 0.0).unwrap();
        doc.add_transition(q0, q1, "a");
        doc.add_transition(q1, q0, "a");
        assert_eq!(doc.classify(), Classification::Dfa);
    }

    #[test]
    fn nfa_classification_via_epsilon() {
        let mut doc = FaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 0.0, 0.0).unwrap();
        doc.add_epsilon_transition(q0, q1);
        assert_eq!(doc.classify(), Classification::Nfa);
    }

    #[test]
    fn nfa_classification_via_nondeterminism() {
        let mut doc = FaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 0.0, 0.0).unwrap();
        let q2 = doc.add_state("q2", 0.0, 0.0).unwrap();
        doc.add_transition(q0, q1, "a");
        doc.add_transition(q0, q2, "a"); // two targets for (q0, 'a')
        assert_eq!(doc.classify(), Classification::Nfa);
    }
}
