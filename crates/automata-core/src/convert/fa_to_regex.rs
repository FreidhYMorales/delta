//! FA -> regular expression by GNFA state elimination — the classic
//! construction (Sipser, *Introduction to the Theory of Computation*,
//! Thm. 1.60), verified against JFLAP's own
//! `automata.fsa.FSAToRegularExpressionConverter` (see `docs/decisions.md`).
//! JFLAP mutates a working copy of the automaton in place, forcing a single
//! final state ≠ the initial state first (`getSingleFinalState`) as a
//! special case. This instead adds two synthetic nodes (a start and an
//! accept, connected to the real automaton by ε) and eliminates every real
//! state uniformly — no special-casing an automaton whose initial state is
//! itself accepting, or one with zero or several final states.

use std::collections::HashMap;

use crate::ids::StateId;
use crate::model::fa::FaDoc;
use crate::regex::Regex;

/// Convert `doc` (any FA — DFA or NFA, with or without epsilon) to an
/// equivalent regular expression. Always succeeds: a `doc` with no initial
/// state, or with no path from the initial state to any accepting state,
/// both correctly reduce to `Regex::Empty` (∅, matches nothing) — not a
/// special case, just what the elimination arithmetic produces when there's
/// no route from the synthetic start to the synthetic accept.
pub fn fa_to_regex(doc: &FaDoc) -> Regex {
    let Some(initial) = doc.initial_state() else {
        return Regex::Empty;
    };

    let mut delta_targets: HashMap<StateId, Vec<StateId>> = HashMap::new();
    for ((from, to), _set) in doc.edges() {
        delta_targets.entry(*from).or_default().push(*to);
    }
    let mut reachable: Vec<StateId> = Vec::new();
    {
        let mut seen = std::collections::HashSet::new();
        let mut stack = vec![initial];
        seen.insert(initial);
        while let Some(s) = stack.pop() {
            reachable.push(s);
            for &t in delta_targets.get(&s).into_iter().flatten() {
                if seen.insert(t) {
                    stack.push(t);
                }
            }
        }
    }
    reachable.sort_by_key(|s| s.0);

    let n = reachable.len();
    let idx_of: HashMap<StateId, usize> = reachable.iter().enumerate().map(|(i, &s)| (s, i)).collect();
    let synth_start = n;
    let synth_accept = n + 1;

    // Seed the complete labeled graph: every real edge becomes a Regex
    // label (unioning multiple symbols/epsilon between the same pair into
    // one), plus ε from the synthetic start into the real initial state and
    // from every real accepting state into the synthetic accept.
    let mut edge: HashMap<(usize, usize), Regex> = HashMap::new();
    let union_into = |edge: &mut HashMap<(usize, usize), Regex>, key: (usize, usize), label: Regex| {
        let prev = edge.remove(&key).unwrap_or(Regex::Empty);
        edge.insert(key, prev.union(label));
    };

    for ((from, to), set) in doc.edges() {
        let (Some(&p), Some(&q)) = (idx_of.get(from), idx_of.get(to)) else { continue };
        if set.epsilon {
            union_into(&mut edge, (p, q), Regex::Epsilon);
        }
        for &sym in &set.symbols {
            let label = doc.symbol_label(sym).expect("interned symbol has label").to_string();
            union_into(&mut edge, (p, q), Regex::Symbol(label));
        }
    }
    union_into(&mut edge, (synth_start, idx_of[&initial]), Regex::Epsilon);
    for (i, &s) in reachable.iter().enumerate() {
        if doc.is_accepting(s) {
            union_into(&mut edge, (i, synth_accept), Regex::Epsilon);
        }
    }

    // Eliminate every real state, one at a time, in a fixed order (ascending
    // index — arbitrary but reproducible; the resulting regex is
    // language-equivalent regardless of elimination order, though its exact
    // syntactic form can differ).
    let mut remaining: Vec<usize> = std::iter::once(synth_start).chain(0..n).chain(std::iter::once(synth_accept)).collect();
    for k in 0..n {
        let others: Vec<usize> = remaining.iter().copied().filter(|&x| x != k).collect();
        let kk = edge.get(&(k, k)).cloned().unwrap_or(Regex::Empty).star();
        for &p in &others {
            let pk = match edge.get(&(p, k)) {
                Some(r) if *r != Regex::Empty => r.clone(),
                _ => continue,
            };
            for &q in &others {
                let kq = match edge.get(&(k, q)) {
                    Some(r) if *r != Regex::Empty => r.clone(),
                    _ => continue,
                };
                let through_k = pk.clone().concat(kk.clone()).concat(kq);
                union_into(&mut edge, (p, q), through_k);
            }
        }
        remaining.retain(|&x| x != k);
    }

    // Only `synth_start` and `synth_accept` remain. General 2-state GNFA
    // formula (matches JFLAP's `getFinalExpression`): any number of round
    // trips start->accept->start, then one final start->accept leg.
    let ii = edge.get(&(synth_start, synth_start)).cloned().unwrap_or(Regex::Empty);
    let ij = edge.get(&(synth_start, synth_accept)).cloned().unwrap_or(Regex::Empty);
    let jj = edge.get(&(synth_accept, synth_accept)).cloned().unwrap_or(Regex::Empty);
    let ji = edge.get(&(synth_accept, synth_start)).cloned().unwrap_or(Regex::Empty);

    let round_trip = ii.clone().star().concat(ij.clone()).concat(jj.clone().star()).concat(ji);
    let final_leg = ii.star().concat(ij).concat(jj.star());
    round_trip.star().concat(final_leg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::convert::regex_to_nfa::regex_to_nfa;
    use crate::engine::fa::FaEngine;
    use crate::engine::{run_bounded, Budget, Outcome};
    use crate::ids::SymbolId as Sym;

    fn word_to_symbols(doc: &FaDoc, w: &str) -> Vec<Sym> {
        w.chars().enumerate().map(|(i, c)| doc.symbol_label_to_id(&c.to_string()).unwrap_or(Sym(u32::MAX - i as u32))).collect()
    }

    fn accepts(doc: &FaDoc, w: &str) -> bool {
        let engine = FaEngine::compile(doc);
        let input = word_to_symbols(doc, w);
        run_bounded(&engine, &input, Budget::default()).outcome == Outcome::Accepted
    }

    #[test]
    fn a_single_transition_dfa_gives_exactly_that_symbol() {
        let mut doc = FaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 0.0, 0.0).unwrap();
        doc.set_initial(Some(q0));
        doc.set_accepting(q1, true);
        doc.add_transition(q0, q1, "a");

        assert_eq!(fa_to_regex(&doc).to_string(), "a");
    }

    #[test]
    fn an_accepting_initial_state_with_no_transitions_gives_epsilon() {
        let mut doc = FaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        doc.set_initial(Some(q0));
        doc.set_accepting(q0, true);

        assert_eq!(fa_to_regex(&doc).to_string(), "\u{03b5}");
    }

    #[test]
    fn no_accepting_state_gives_the_empty_language() {
        let mut doc = FaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        doc.set_initial(Some(q0));

        assert_eq!(fa_to_regex(&doc), Regex::Empty);
    }

    #[test]
    fn no_initial_state_gives_the_empty_language() {
        let mut doc = FaDoc::new();
        doc.add_state("q0", 0.0, 0.0).unwrap();
        assert_eq!(fa_to_regex(&doc), Regex::Empty);
    }

    #[test]
    fn a_self_loop_plus_one_symbol_gives_a_star_prefix() {
        // Accepts a*b: q0 -a-> q0 (self loop), q0 -b-> q1 (accept).
        let mut doc = FaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 0.0, 0.0).unwrap();
        doc.set_initial(Some(q0));
        doc.set_accepting(q1, true);
        doc.add_transition(q0, q0, "a");
        doc.add_transition(q0, q1, "b");

        assert_eq!(fa_to_regex(&doc).to_string(), "a*b");
    }

    #[test]
    fn round_trip_matches_language_of_the_branching_ends_in_ab_nfa() {
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

        let r = fa_to_regex(&nfa);
        let rebuilt = regex_to_nfa(&r);
        for w in ["", "a", "b", "ab", "aab", "abab", "ba", "bab", "aba", "bb"] {
            assert_eq!(accepts(&nfa, w), accepts(&rebuilt, w), "mismatch on {w:?} (regex was {r})");
        }
    }

    #[test]
    fn round_trip_matches_language_of_an_epsilon_union() {
        // Accepts exactly "a" or "b".
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

        let r = fa_to_regex(&nfa);
        let rebuilt = regex_to_nfa(&r);
        for w in ["a", "b", "", "ab", "aa", "ba"] {
            assert_eq!(accepts(&nfa, w), accepts(&rebuilt, w), "mismatch on {w:?} (regex was {r})");
        }
    }

    /// The real proof: for random small NFAs (epsilon and real branching
    /// included), `regex_to_nfa(fa_to_regex(nfa))` must accept exactly the
    /// same words as `nfa` — not compared structurally (meaningless across
    /// a regex-synthesis-then-Thompson-construction round trip), compared by
    /// language.
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
                n in 2usize..6,
                edges in prop::collection::vec((0usize..6, 0usize..6, edge_kind_strategy()), 0..10),
                initial in 0usize..6,
                accepting in prop::collection::vec(0usize..6, 0..3),
                words in prop::collection::vec("[ab]{0,5}", 0..15),
            ) {
                let nfa = build_random_nfa(n, &edges, initial, &accepting);
                let r = fa_to_regex(&nfa);
                let rebuilt = regex_to_nfa(&r);
                for w in &words {
                    prop_assert_eq!(accepts(&nfa, w), accepts(&rebuilt, w), "mismatch on word {:?}", w);
                }
            }
        }
    }
}
