//! DFA minimization by partition refinement (Moore's algorithm).
//!
//! Verified against JFLAP's own `automata.fsa.Minimizer` (decompiled from
//! `idea/JFLAP7.1-output`, see `docs/decisions.md`): same overall shape —
//! reject non-deterministic input, drop unreachable states, then refine an
//! initial accepting/non-accepting partition until stable — with one
//! deliberate divergence: JFLAP materializes a real trap state to make the
//! DFA total before refining, then strips it (and anything merged with it)
//! back out of the result. This does the same thing without ever allocating
//! a real `StateId` for it: `None` (missing transition) is treated as one
//! extra, virtual participant in the *same* refinement — not a special case
//! bolted on afterward. That distinction matters: an earlier version of this
//! function special-cased `None` only when comparing signatures, which meant
//! a hand-drawn *explicit* trap state (real, self-looping, non-accepting)
//! never got recognized as equivalent to an *implicit* dead end (a state
//! with simply no transition at all) — same language either way, but a
//! needlessly larger result. Giving `None` a real seat in the partition
//! (see `target`/`is_accepting` below) fixes that; see the
//! `merges_an_explicit_dead_end_state_with_implicitly_missing_transitions`
//! test.

use std::collections::{HashMap, HashSet};

use crate::ids::{StateId, SymbolId};
use crate::model::fa::{Classification, FaDoc};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum MinimizeError {
    #[error(
        "cannot minimize a non-deterministic automaton (it has epsilon transitions or an \
         ambiguous (state,symbol) target) — convert with nfa_to_dfa first"
    )]
    NotDeterministic,
}

/// Minimize `doc`, which must already be deterministic (`classify() ==
/// Dfa`) — mirrors JFLAP's own `Minimizer.getMinimizeableAutomaton`, which
/// refuses an NFA outright rather than silently converting it.
///
/// Only states reachable from the initial state participate (unreachable
/// states are dropped, same as JFLAP's explicit `UnreachableStatesDetector`
/// pass). If `doc` has no initial state, the result is the empty automaton.
///
/// Result labels are `{q0,q1}`-style — the sorted original labels merged
/// into that state — matching `nfa_to_dfa`'s convention (JFLAP instead joins
/// raw numeric state ids with no braces; the difference is cosmetic).
pub fn minimize_dfa(doc: &FaDoc) -> Result<FaDoc, MinimizeError> {
    if doc.classify() != Classification::Dfa {
        return Err(MinimizeError::NotDeterministic);
    }

    let alphabet: Vec<SymbolId> = doc.alphabet().into_iter().collect();
    let mut delta: HashMap<(StateId, SymbolId), StateId> = HashMap::new();
    for ((from, to), set) in doc.edges() {
        for &sym in &set.symbols {
            delta.insert((*from, sym), *to);
        }
    }

    let mut reachable: Vec<StateId> = Vec::new();
    if let Some(start) = doc.initial_state() {
        let mut seen: HashSet<StateId> = HashSet::new();
        let mut stack = vec![start];
        seen.insert(start);
        while let Some(s) = stack.pop() {
            reachable.push(s);
            for &a in &alphabet {
                if let Some(&t) = delta.get(&(s, a)) {
                    if seen.insert(t) {
                        stack.push(t);
                    }
                }
            }
        }
    }
    reachable.sort_by_key(|s| s.0);

    if reachable.is_empty() {
        return Ok(FaDoc::new());
    }

    // `None` = the implicit dead end every missing (state,symbol) transition
    // goes to. It participates in refinement exactly like a real state:
    // non-accepting, self-loops to itself on every symbol.
    let universe: Vec<Option<StateId>> =
        std::iter::once(None).chain(reachable.iter().copied().map(Some)).collect();
    let target = |u: Option<StateId>, a: SymbolId| -> Option<StateId> {
        u.and_then(|s| delta.get(&(s, a)).copied())
    };
    let is_accepting = |u: Option<StateId>| u.is_some_and(|s| doc.is_accepting(s));

    let mut class_of: HashMap<Option<StateId>, usize> =
        universe.iter().map(|&u| (u, usize::from(is_accepting(u)))).collect();
    let mut num_classes = usize::MAX; // sentinel: forces at least one refinement pass

    loop {
        let mut signature_to_class: HashMap<(usize, Vec<usize>), usize> = HashMap::new();
        let mut next_class_of: HashMap<Option<StateId>, usize> = HashMap::with_capacity(universe.len());
        for &u in &universe {
            let targets: Vec<usize> = alphabet.iter().map(|&a| class_of[&target(u, a)]).collect();
            let key = (class_of[&u], targets);
            let fresh_id = signature_to_class.len();
            next_class_of.insert(u, *signature_to_class.entry(key).or_insert(fresh_id));
        }
        let next_num_classes = signature_to_class.len();
        class_of = next_class_of;
        if next_num_classes == num_classes {
            break;
        }
        num_classes = next_num_classes;
    }

    let dead_class = class_of[&None];
    build_minimized(doc, &reachable, &class_of, dead_class, num_classes, &delta, &alphabet)
}

fn build_minimized(
    doc: &FaDoc,
    reachable: &[StateId],
    class_of: &HashMap<Option<StateId>, usize>,
    dead_class: usize,
    num_classes: usize,
    delta: &HashMap<(StateId, SymbolId), StateId>,
    alphabet: &[SymbolId],
) -> Result<FaDoc, MinimizeError> {
    let mut out = FaDoc::new();
    let mut members_of: Vec<Vec<StateId>> = vec![Vec::new(); num_classes];
    for &s in reachable {
        members_of[class_of[&Some(s)]].push(s);
    }

    // Classes equal to `dead_class` are never materialized — whether they
    // contain only the implicit `None` participant, or also real states
    // that turned out to be equivalent to it (an explicit trap, or any
    // other state that can never reach acceptance).
    let mut out_id_of: Vec<Option<StateId>> = vec![None; num_classes];
    for (class_id, members) in members_of.iter().enumerate() {
        if class_id == dead_class {
            continue;
        }
        let mut labels: Vec<&str> = members.iter().filter_map(|&s| doc.state_label(s)).collect();
        labels.sort_unstable();
        let label = format!("{{{}}}", labels.join(","));
        let id = out.add_state(&label, 0.0, 0.0).expect("class labels are unique by construction");
        out.set_accepting(id, members.iter().any(|&s| doc.is_accepting(s)));
        out_id_of[class_id] = Some(id);
    }

    if let Some(initial) = doc.initial_state() {
        if let Some(&class_id) = class_of.get(&Some(initial)) {
            out.set_initial(out_id_of[class_id]); // None if the whole automaton is dead
        }
    }

    for (class_id, members) in members_of.iter().enumerate() {
        let Some(from_id) = out_id_of[class_id] else { continue };
        let representative = members[0];
        for &a in alphabet {
            let Some(&target) = delta.get(&(representative, a)) else { continue };
            let Some(to_id) = out_id_of[class_of[&Some(target)]] else { continue };
            let label = doc.symbol_label(a).expect("symbol in alphabet() is interned");
            out.add_transition(from_id, to_id, label);
        }
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::fa::FaEngine;
    use crate::engine::{run_bounded, Budget, Outcome};

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

    /// Independent (does not call `minimize_dfa` or reuse any of its
    /// helpers) check that no two states of `doc` are Myhill-Nerode
    /// equivalent — the dual "table-filling" formulation of the same idea:
    /// mark pairs as *distinguished* and iterate to a fixpoint, instead of
    /// *grouping* equivalent states together like the production code does.
    /// Missing transitions are unified with one shared implicit "dead"
    /// participant, same semantics `minimize_dfa` itself uses, so this
    /// exercises the same subtlety with a differently-shaped algorithm
    /// rather than just re-running the thing under test.
    fn is_truly_minimal(doc: &FaDoc) -> bool {
        let states: Vec<StateId> = doc.states().collect();
        let n = states.len();
        if n <= 1 {
            return true;
        }
        let alphabet: Vec<SymbolId> = doc.alphabet().into_iter().collect();
        let mut delta: HashMap<(StateId, SymbolId), StateId> = HashMap::new();
        for ((from, to), set) in doc.edges() {
            for &sym in &set.symbols {
                delta.insert((*from, sym), *to);
            }
        }
        let idx: HashMap<StateId, usize> = states.iter().enumerate().map(|(i, &s)| (s, i)).collect();
        let dead = n; // sentinel index for "no transition"
        let total = n + 1;

        let target = |u: usize, a: SymbolId| -> usize {
            if u == dead {
                return dead;
            }
            delta.get(&(states[u], a)).map_or(dead, |t| idx[t])
        };
        let is_acc = |u: usize| u != dead && doc.is_accepting(states[u]);

        let mut distinguished = vec![vec![false; total]; total];
        // `i`/`j` index the same 2D matrix simultaneously (both dimensions,
        // not just one row) — an iterator adapter here would be less clear
        // than plain indices, not more.
        #[allow(clippy::needless_range_loop)]
        for i in 0..total {
            for j in (i + 1)..total {
                if is_acc(i) != is_acc(j) {
                    distinguished[i][j] = true;
                    distinguished[j][i] = true;
                }
            }
        }
        loop {
            let mut changed = false;
            #[allow(clippy::needless_range_loop)]
            for i in 0..total {
                for j in (i + 1)..total {
                    if distinguished[i][j] {
                        continue;
                    }
                    for &a in &alphabet {
                        let (ti, tj) = (target(i, a), target(j, a));
                        if ti != tj && distinguished[ti.min(tj)][ti.max(tj)] {
                            distinguished[i][j] = true;
                            distinguished[j][i] = true;
                            changed = true;
                            break;
                        }
                    }
                }
            }
            if !changed {
                break;
            }
        }

        (0..n).all(|i| (0..n).filter(|&j| j != i).all(|j| distinguished[i][j]))
    }

    #[test]
    fn rejects_a_non_deterministic_input_like_jflaps_own_minimizer_does() {
        let mut nfa = FaDoc::new();
        let q0 = nfa.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = nfa.add_state("q1", 0.0, 0.0).unwrap();
        nfa.set_initial(Some(q0));
        nfa.add_epsilon_transition(q0, q1);

        assert_eq!(minimize_dfa(&nfa), Err(MinimizeError::NotDeterministic));
    }

    #[test]
    fn merges_two_states_that_are_provably_equivalent() {
        // q1 and q2 are indistinguishable: neither is accepting, and both
        // go to q3 (accepting, absorbing) on every symbol. q0 must survive
        // as its own state (it's not accepting and its behavior on '0'
        // differs from its behavior on '1', unlike q1/q2).
        let mut dfa = FaDoc::new();
        let q0 = dfa.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = dfa.add_state("q1", 0.0, 0.0).unwrap();
        let q2 = dfa.add_state("q2", 0.0, 0.0).unwrap();
        let q3 = dfa.add_state("q3", 0.0, 0.0).unwrap();
        dfa.set_initial(Some(q0));
        dfa.set_accepting(q3, true);
        dfa.add_transition(q0, q1, "0");
        dfa.add_transition(q0, q2, "1");
        dfa.add_transition(q1, q3, "0");
        dfa.add_transition(q1, q3, "1");
        dfa.add_transition(q2, q3, "0");
        dfa.add_transition(q2, q3, "1");
        dfa.add_transition(q3, q3, "0");
        dfa.add_transition(q3, q3, "1");

        let min = minimize_dfa(&dfa).unwrap();
        assert_eq!(min.states().count(), 3, "q1 and q2 should have merged into one state");
        assert_eq!(min.classify(), Classification::Dfa);
        assert!(is_truly_minimal(&min));

        for w in ["", "0", "1", "00", "01", "10", "11", "000", "101"] {
            assert_eq!(accepts(&dfa, w), accepts(&min, w), "mismatch on {w:?}");
        }
    }

    #[test]
    fn merges_an_explicit_dead_end_state_with_implicitly_missing_transitions() {
        // trap is a real, reachable, self-looping non-accepting state — the
        // kind a student draws by hand to make a DFA "look" total. q1 is
        // accepting but has *no* transition on 'b' at all: an implicit dead
        // end. Both mean exactly the same thing ("reject no matter what
        // comes after"), so a truly minimal result must recognize trap as
        // just another way of saying "no transition" and drop it — this is
        // the bug an earlier version of `minimize_dfa` had (see module doc).
        let mut dfa = FaDoc::new();
        let q0 = dfa.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = dfa.add_state("q1", 0.0, 0.0).unwrap();
        let trap = dfa.add_state("trap", 0.0, 0.0).unwrap();
        dfa.set_initial(Some(q0));
        dfa.set_accepting(q1, true);
        dfa.add_transition(q0, q1, "a");
        dfa.add_transition(q0, trap, "b");
        dfa.add_transition(q1, q1, "a");
        dfa.add_transition(trap, trap, "a");
        dfa.add_transition(trap, trap, "b");
        // q1 has no transition on 'b' at all: implicit dead end.

        let min = minimize_dfa(&dfa).unwrap();
        assert_eq!(min.states().count(), 2, "trap should merge with the implicit dead end and get dropped");
        assert!(is_truly_minimal(&min));

        for w in ["", "a", "b", "aa", "ab", "ba", "aaa"] {
            assert_eq!(accepts(&dfa, w), accepts(&min, w), "mismatch on {w:?}");
        }
    }

    #[test]
    fn drops_unreachable_states_and_keeps_the_language() {
        let mut dfa = FaDoc::new();
        let q0 = dfa.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = dfa.add_state("q1", 0.0, 0.0).unwrap();
        let unreachable = dfa.add_state("qU", 0.0, 0.0).unwrap();
        dfa.set_initial(Some(q0));
        dfa.add_transition(q0, q1, "a");
        dfa.set_accepting(q1, true);
        dfa.add_transition(unreachable, unreachable, "a"); // never referenced by any reachable edge

        let min = minimize_dfa(&dfa).unwrap();
        assert_eq!(min.states().count(), 2);
        assert!(is_truly_minimal(&min));
        assert!(accepts(&min, "a"));
        assert!(!accepts(&min, ""));
    }

    #[test]
    fn an_already_minimal_dfa_is_left_the_same_size() {
        let mut dfa = FaDoc::new();
        let even = dfa.add_state("even", 0.0, 0.0).unwrap();
        let odd = dfa.add_state("odd", 0.0, 0.0).unwrap();
        dfa.set_initial(Some(even));
        dfa.set_accepting(even, true);
        dfa.add_transition(even, odd, "a");
        dfa.add_transition(odd, even, "a");

        let min = minimize_dfa(&dfa).unwrap();
        assert_eq!(min.states().count(), 2);
    }

    #[test]
    fn minimizing_the_empty_automaton_is_a_no_op() {
        let doc = FaDoc::new();
        let min = minimize_dfa(&doc).unwrap();
        assert_eq!(min.states().count(), 0);
    }

    /// Cross-checks `minimize_dfa` for language equivalence against random
    /// deterministic automata — built directly as a `(state, symbol) ->
    /// Option<state>` function so non-determinism is impossible *by
    /// construction*, rather than filtering out conflicting random edges.
    mod minimize_preserves_language {
        use super::*;
        use proptest::prelude::*;

        fn build_random_dfa(
            n: usize,
            targets: &[Option<usize>], // length n*2: [state0-on-a, state0-on-b, state1-on-a, ...]
            initial: usize,
            accepting: &[usize],
        ) -> FaDoc {
            let mut doc = FaDoc::new();
            let ids: Vec<_> = (0..n).map(|i| doc.add_state(&format!("q{i}"), 0.0, 0.0).unwrap()).collect();
            doc.set_initial(Some(ids[initial % n]));
            for &a in accepting {
                doc.set_accepting(ids[a % n], true);
            }
            for (i, &target) in targets.iter().enumerate() {
                let from = ids[i / 2];
                let symbol = if i % 2 == 0 { "a" } else { "b" };
                if let Some(t) = target {
                    doc.add_transition(from, ids[t % n], symbol);
                }
            }
            doc
        }

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(256))]

            #[test]
            fn matches(
                n in 2usize..8,
                targets in prop::collection::vec(prop::option::of(0usize..8), 4..16),
                initial in 0usize..8,
                accepting in prop::collection::vec(0usize..8, 0..4),
                words in prop::collection::vec("[ab]{0,6}", 0..20),
            ) {
                let n_targets = 2 * n;
                let mut targets = targets;
                targets.resize(n_targets, None);
                let dfa = build_random_dfa(n, &targets, initial, &accepting);
                prop_assert_eq!(dfa.classify(), Classification::Dfa);

                let min = minimize_dfa(&dfa).unwrap();
                prop_assert_eq!(min.classify(), Classification::Dfa);
                prop_assert!(min.states().count() <= dfa.states().count());
                prop_assert!(is_truly_minimal(&min), "result of minimize_dfa was not actually minimal");

                for w in &words {
                    prop_assert_eq!(accepts(&dfa, w), accepts(&min, w), "mismatch on word {:?}", w);
                }
            }
        }
    }
}
