//! FA -> right-linear grammar (`fa_to_regular_grammar`) and back
//! (`regular_grammar_to_nfa`) — verified against JFLAP's own
//! `automata.fsa.FSAToRegularGrammarConverter` / `grammar.reg.RightLinearGrammarToFSAConverter`
//! (see `docs/decisions.md`). Mechanical either way: one production per
//! transition (`p -[a]-> q` becomes `P -> aQ`), one terminating production
//! per accepting state (`P -> ε`), and the reverse undoes exactly that.

use std::collections::HashMap;

use crate::grammar::{Production, RegularGrammar};
use crate::ids::StateId;
use crate::model::fa::FaDoc;

pub fn fa_to_regular_grammar(doc: &FaDoc) -> RegularGrammar {
    let start = doc.initial_state().map(|s| doc.state_label(s).expect("alive state has label").to_string());

    let mut productions: Vec<Production> = Vec::new();
    for ((from, to), set) in doc.edges() {
        let lhs = doc.state_label(*from).expect("alive state has label").to_string();
        let rhs = doc.state_label(*to).expect("alive state has label").to_string();
        if set.epsilon {
            productions.push(Production::Derive { lhs: lhs.clone(), symbol: String::new(), rhs: rhs.clone() });
        }
        for &sym in &set.symbols {
            let symbol = doc.symbol_label(sym).expect("interned symbol has label").to_string();
            productions.push(Production::Derive { lhs: lhs.clone(), symbol, rhs: rhs.clone() });
        }
    }
    for s in doc.states() {
        if doc.is_accepting(s) {
            productions.push(Production::Terminate { lhs: doc.state_label(s).expect("alive state has label").to_string() });
        }
    }

    // `doc.edges()` iterates a HashMap; sort for reproducible output.
    productions.sort();
    RegularGrammar { start, productions }
}

fn ensure_state(doc: &mut FaDoc, id_of: &mut HashMap<String, StateId>, name: &str) -> StateId {
    if let Some(&id) = id_of.get(name) {
        return id;
    }
    let id = doc.add_state(name, 0.0, 0.0).expect("non-terminal names are unique by construction");
    id_of.insert(name.to_string(), id);
    id
}

/// Rebuild an automaton from a right-linear grammar: one state per
/// non-terminal, one transition per `Derive` production, and `Terminate`
/// productions mark their left-hand state accepting. Every non-terminal
/// that appears anywhere (as a `lhs`, or as the `rhs` of a `Derive`) gets a
/// state, even if some production set only mentions it on one side.
pub fn regular_grammar_to_nfa(grammar: &RegularGrammar) -> FaDoc {
    let mut doc = FaDoc::new();
    let mut id_of: HashMap<String, StateId> = HashMap::new();

    for p in &grammar.productions {
        match p {
            Production::Derive { lhs, symbol, rhs } => {
                let from = ensure_state(&mut doc, &mut id_of, lhs);
                let to = ensure_state(&mut doc, &mut id_of, rhs);
                if symbol.is_empty() {
                    doc.add_epsilon_transition(from, to);
                } else {
                    doc.add_transition(from, to, symbol);
                }
            }
            Production::Terminate { lhs } => {
                let s = ensure_state(&mut doc, &mut id_of, lhs);
                doc.set_accepting(s, true);
            }
        }
    }

    if let Some(start) = &grammar.start {
        let s = ensure_state(&mut doc, &mut id_of, start);
        doc.set_initial(Some(s));
    }

    doc
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::fa::FaEngine;
    use crate::engine::{run_bounded, Budget, Outcome};
    use crate::ids::SymbolId;

    fn word_to_symbols(doc: &FaDoc, w: &str) -> Vec<SymbolId> {
        w.chars()
            .enumerate()
            .map(|(i, c)| doc.symbol_label_to_id(&c.to_string()).unwrap_or(SymbolId(u32::MAX - i as u32)))
            .collect()
    }

    fn accepts(doc: &FaDoc, w: &str) -> bool {
        let engine = FaEngine::compile(doc);
        let input = word_to_symbols(doc, w);
        run_bounded(&engine, &input, Budget::default()).outcome == Outcome::Accepted
    }

    #[test]
    fn converts_a_hand_built_dfa_to_the_exact_expected_productions() {
        // Accepts a+ (one or more 'a's): q0 -a-> q1 (accept), q1 -a-> q1.
        let mut doc = FaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 0.0, 0.0).unwrap();
        doc.set_initial(Some(q0));
        doc.set_accepting(q1, true);
        doc.add_transition(q0, q1, "a");
        doc.add_transition(q1, q1, "a");

        let grammar = fa_to_regular_grammar(&doc);
        assert_eq!(grammar.start.as_deref(), Some("q0"));
        assert_eq!(
            grammar.productions,
            vec![
                Production::Derive { lhs: "q0".into(), symbol: "a".into(), rhs: "q1".into() },
                Production::Derive { lhs: "q1".into(), symbol: "a".into(), rhs: "q1".into() },
                Production::Terminate { lhs: "q1".into() },
            ]
        );
    }

    #[test]
    fn round_trip_through_a_grammar_preserves_language_of_a_hand_built_nfa() {
        // Same branching-NFA shape used in nfa_to_dfa's tests: accepts
        // strings over {a,b} ending in "ab", built with real (state,symbol)
        // branching plus a self-loop.
        let mut nfa = FaDoc::new();
        let q0 = nfa.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = nfa.add_state("q1", 0.0, 0.0).unwrap();
        let q2 = nfa.add_state("q2", 0.0, 0.0).unwrap();
        nfa.set_initial(Some(q0));
        nfa.set_accepting(q2, true);
        nfa.add_transition(q0, q0, "a");
        nfa.add_transition(q0, q0, "b");
        nfa.add_transition(q0, q1, "a");
        nfa.add_transition(q1, q2, "b");

        let grammar = fa_to_regular_grammar(&nfa);
        let round_tripped = regular_grammar_to_nfa(&grammar);

        for w in ["", "a", "b", "ab", "aab", "abab", "ba", "bab", "aba", "bb"] {
            assert_eq!(accepts(&nfa, w), accepts(&round_tripped, w), "mismatch on {w:?}");
        }
    }

    mod round_trip_preserves_language_of_random_nfas {
        use super::*;
        use proptest::prelude::*;

        #[derive(Debug, Clone, Copy)]
        enum EdgeKind {
            Eps,
            A,
            B,
        }

        fn build_random_nfa(n: usize, edges: &[(usize, usize, EdgeKind)], initial: usize, accepting: &[usize]) -> FaDoc {
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
                let grammar = fa_to_regular_grammar(&nfa);
                let round_tripped = regular_grammar_to_nfa(&grammar);

                for w in &words {
                    prop_assert_eq!(accepts(&nfa, w), accepts(&round_tripped, w), "mismatch on word {:?}", w);
                }
            }
        }
    }
}
