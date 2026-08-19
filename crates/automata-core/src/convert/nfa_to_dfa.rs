//! Subset construction: NFA (with or without epsilon transitions) -> an
//! equivalent DFA, by BFS over the same `StateSet`/`Machine::step` machinery
//! `engine::fa` already uses for simulation — a DFA state IS a `StateSet`
//! (an epsilon-closed subset of NFA states), so this reuses the exact same
//! "what does symbol X do from this subset" logic as `sim_trace`/`sim_batch`
//! instead of re-deriving it.

use std::collections::{HashMap, VecDeque};

use crate::engine::fa::{FaEngine, StateSet};
use crate::engine::Machine;
use crate::ids::{StateId, SymbolId};
use crate::model::fa::FaDoc;

/// Convert `doc` (any FA — DFA or NFA, with or without epsilon transitions)
/// into an equivalent DFA via subset construction.
///
/// Only states reachable from the initial state are ever created — there is
/// no separate "remove unreachable states" pass, it falls out of doing a BFS
/// from the start. If `doc` has no initial state, the result has no states
/// (the empty automaton — accepts nothing, same as the source).
///
/// The result is deliberately *not* made total: a subset with no transition
/// on some symbol becomes a DFA state with no outgoing edge for that symbol,
/// not a synthesized trap state — `FaDoc::classify` only requires
/// determinism (at most one target per (state, symbol)), not totality, and
/// the simulation engine already treats "no transition" as a dead end
/// (`Outcome::Stuck`), which is behaviorally identical to routing into an
/// explicit non-accepting trap state.
///
/// Result state labels are `{q0,q1}`-style (the sorted labels of the NFA
/// states in that subset), matching how textbooks/JFLAP itself name subset
/// states, so it's visible *why* a DFA state exists.
pub fn nfa_to_dfa(doc: &FaDoc) -> FaDoc {
    let engine = FaEngine::compile(doc);
    let alphabet: Vec<SymbolId> = doc.alphabet().into_iter().collect();

    let mut out = FaDoc::new();
    let mut id_of: HashMap<StateSet, StateId> = HashMap::new();
    let mut queue: VecDeque<StateSet> = VecDeque::new();

    let Some(start) = engine.start().into_iter().next() else {
        return out; // no initial state in `doc`: empty result, same language.
    };
    let (start_id, _) = intern_subset(doc, &mut out, &mut id_of, &start);
    out.set_initial(Some(start_id));
    queue.push_back(start);

    while let Some(cfg) = queue.pop_front() {
        let from_id = *id_of.get(&cfg).expect("cfg was interned before being queued");
        for &symbol in &alphabet {
            let Some((next, _)) = engine.step(&cfg, std::slice::from_ref(&symbol), 0).into_iter().next() else {
                continue; // no transition on this symbol from this subset
            };
            let (to_id, is_new) = intern_subset(doc, &mut out, &mut id_of, &next);
            if is_new {
                queue.push_back(next);
            }
            let label = doc.symbol_label(symbol).expect("symbol in alphabet() is interned");
            out.add_transition(from_id, to_id, label);
        }
    }

    out
}

/// Get-or-create the output state for a given subset. Returns `(id,
/// is_new)`. Labels are unique by construction: two different `StateSet`s
/// can only produce the same `{...}` label if they contain the same set of
/// NFA state labels, which (labels being unique within `doc`) means the same
/// set of NFA state ids, which means the same `StateSet`.
fn intern_subset(
    doc: &FaDoc,
    out: &mut FaDoc,
    id_of: &mut HashMap<StateSet, StateId>,
    subset: &StateSet,
) -> (StateId, bool) {
    if let Some(&id) = id_of.get(subset) {
        return (id, false);
    }
    let mut labels: Vec<&str> =
        subset.0.ones().filter_map(|idx| doc.state_label(StateId(idx as u32))).collect();
    labels.sort_unstable();
    let label = format!("{{{}}}", labels.join(","));
    let accepting = subset.0.ones().any(|idx| doc.is_accepting(StateId(idx as u32)));

    let id = out.add_state(&label, 0.0, 0.0).expect("subset labels are unique by construction");
    out.set_accepting(id, accepting);
    id_of.insert(subset.clone(), id);
    (id, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{run_bounded, Budget, Outcome};
    use crate::model::fa::Classification;

    /// Same sentinel trick as `commands::sim::word_to_symbols` in
    /// `src-tauri` and `automata-cli`'s `word_to_symbols`: a symbol absent
    /// from `doc`'s alphabet gets an id that can't match any real `delta`
    /// entry, instead of panicking — needed here because the proptest below
    /// compares an NFA and its DFA, which intern "a"/"b" independently and
    /// may not agree on which symbols exist at all.
    fn word_to_symbols(doc: &FaDoc, w: &str) -> Vec<SymbolId> {
        w.chars()
            .enumerate()
            .map(|(i, c)| doc.symbol_label_to_id(&c.to_string()).unwrap_or(SymbolId(u32::MAX - i as u32)))
            .collect()
    }

    fn accepts(doc: &FaDoc, s: &str) -> bool {
        let engine = FaEngine::compile(doc);
        let input = word_to_symbols(doc, s);
        run_bounded(&engine, &input, Budget::default()).outcome == Outcome::Accepted
    }

    #[test]
    fn subset_construction_of_branching_nfa_matches_language_and_is_deterministic() {
        // Accepts strings over {a,b} ending in "ab", built the classic
        // nondeterministic way: q0 self-loops while scanning, and *also*
        // nondeterministically guesses "this 'a' starts the ending" — a
        // genuine (state,symbol)-with-two-targets branch, not just epsilon.
        let mut nfa = FaDoc::new();
        let q0 = nfa.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = nfa.add_state("q1", 0.0, 0.0).unwrap();
        let q2 = nfa.add_state("q2", 0.0, 0.0).unwrap();
        nfa.set_initial(Some(q0));
        nfa.set_accepting(q2, true);
        nfa.add_transition(q0, q0, "a");
        nfa.add_transition(q0, q0, "b");
        nfa.add_transition(q0, q1, "a"); // second target for (q0, 'a'): real NFA branching
        nfa.add_transition(q1, q2, "b");

        assert_eq!(nfa.classify(), Classification::Nfa);

        let dfa = nfa_to_dfa(&nfa);
        assert_eq!(dfa.classify(), Classification::Dfa);

        for (s, expected) in [
            ("ab", true), ("aab", true), ("abab", true), ("bab", true),
            ("", false), ("a", false), ("b", false), ("ba", false), ("aba", false), ("bb", false),
        ] {
            assert_eq!(accepts(&nfa, s), expected, "nfa mismatch on {s:?}");
            assert_eq!(accepts(&dfa, s), expected, "dfa mismatch on {s:?}");
        }
    }

    #[test]
    fn subset_construction_collapses_an_epsilon_union() {
        // Accepts exactly "a" or "b", built as an epsilon-union of two
        // single-symbol branches.
        let mut nfa = FaDoc::new();
        let q0 = nfa.add_state("q0", 0.0, 0.0).unwrap();
        let qa0 = nfa.add_state("qa0", 0.0, 0.0).unwrap();
        let qa1 = nfa.add_state("qa1", 0.0, 0.0).unwrap();
        let qb0 = nfa.add_state("qb0", 0.0, 0.0).unwrap();
        let qb1 = nfa.add_state("qb1", 0.0, 0.0).unwrap();
        nfa.set_initial(Some(q0));
        nfa.add_epsilon_transition(q0, qa0);
        nfa.add_epsilon_transition(q0, qb0);
        nfa.add_transition(qa0, qa1, "a");
        nfa.add_transition(qb0, qb1, "b");
        nfa.set_accepting(qa1, true);
        nfa.set_accepting(qb1, true);

        let dfa = nfa_to_dfa(&nfa);
        assert_eq!(dfa.classify(), Classification::Dfa);

        for (s, expected) in [("a", true), ("b", true), ("", false), ("ab", false), ("aa", false)] {
            assert_eq!(accepts(&dfa, s), expected, "dfa mismatch on {s:?}");
        }
    }

    #[test]
    fn subset_construction_of_an_already_dfa_drops_unreachable_states_only() {
        let mut doc = FaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 0.0, 0.0).unwrap();
        let unreachable = doc.add_state("qU", 0.0, 0.0).unwrap();
        doc.set_initial(Some(q0));
        doc.add_transition(q0, q1, "a");
        doc.set_accepting(q1, true);
        let _ = unreachable; // never referenced by any edge or the initial state

        let dfa = nfa_to_dfa(&doc);
        assert_eq!(dfa.states().count(), 2);
        assert_eq!(dfa.classify(), Classification::Dfa);
        assert!(accepts(&dfa, "a"));
        assert!(!accepts(&dfa, ""));
    }

    #[test]
    fn subset_construction_with_no_initial_state_is_the_empty_automaton() {
        let doc = FaDoc::new();
        let dfa = nfa_to_dfa(&doc);
        assert_eq!(dfa.states().count(), 0);
    }

    /// Cross-checks `nfa_to_dfa` for language equivalence — not structural
    /// equality, which would be meaningless across a renaming conversion —
    /// against random small NFAs (with epsilon and real branching
    /// nondeterminism) over many random words.
    mod nfa_to_dfa_preserves_language {
        use super::*;
        use proptest::prelude::*;

        #[derive(Debug, Clone, Copy)]
        enum EdgeKind {
            Eps,
            A,
            B,
        }

        fn build_random_nfa(
            n: usize,
            edges: &[(usize, usize, EdgeKind)],
            initial: usize,
            accepting: &[usize],
        ) -> FaDoc {
            let mut doc = FaDoc::new();
            let ids: Vec<_> = (0..n).map(|i| doc.add_state(&format!("q{i}"), 0.0, 0.0).unwrap()).collect();
            doc.set_initial(Some(ids[initial % n]));
            for &a in accepting {
                doc.set_accepting(ids[a % n], true);
            }
            for &(from, to, kind) in edges {
                let (f, t) = (ids[from % n], ids[to % n]);
                match kind {
                    EdgeKind::Eps => doc.add_epsilon_transition(f, t),
                    EdgeKind::A => {
                        doc.add_transition(f, t, "a");
                    }
                    EdgeKind::B => {
                        doc.add_transition(f, t, "b");
                    }
                }
            }
            doc
        }

        fn edge_kind_strategy() -> impl Strategy<Value = EdgeKind> {
            prop_oneof![Just(EdgeKind::Eps), Just(EdgeKind::A), Just(EdgeKind::B)]
        }

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(256))]

            #[test]
            fn matches(
                n in 2usize..8,
                edges in prop::collection::vec((0usize..8, 0usize..8, edge_kind_strategy()), 0..15),
                initial in 0usize..8,
                accepting in prop::collection::vec(0usize..8, 0..4),
                words in prop::collection::vec("[ab]{0,6}", 0..20),
            ) {
                let nfa = build_random_nfa(n, &edges, initial, &accepting);
                let dfa = nfa_to_dfa(&nfa);
                prop_assert_eq!(dfa.classify(), Classification::Dfa);

                let nfa_engine = FaEngine::compile(&nfa);
                let dfa_engine = FaEngine::compile(&dfa);
                for w in &words {
                    let nfa_input = word_to_symbols(&nfa, w);
                    let dfa_input = word_to_symbols(&dfa, w);
                    let nfa_accepts = run_bounded(&nfa_engine, &nfa_input, Budget::default()).outcome == Outcome::Accepted;
                    let dfa_accepts = run_bounded(&dfa_engine, &dfa_input, Budget::default()).outcome == Outcome::Accepted;
                    prop_assert_eq!(nfa_accepts, dfa_accepts, "mismatch on word {:?}", w);
                }
            }
        }
    }
}
