//! Compiled finite-automaton engine: a fast, index-based `Machine` impl
//! compiled from an edit-facing [`crate::model::fa::FaDoc`]. See design D2.
//!
//! Epsilon-closures are computed once per compile (not per step). Stepping
//! ORs the closures of `delta` targets: O(|cfg| * outdeg), no per-step BFS,
//! no scan over all transitions.

use std::collections::HashMap;

use fixedbitset::FixedBitSet;
use smallvec::{smallvec, SmallVec};

use crate::engine::Machine;
use crate::ids::{StateId, SymbolId};
use crate::model::fa::FaDoc;

/// FA configuration: the whole epsilon-closed set of active states after
/// consuming some prefix of the input. FA collapses nondeterminism inside
/// this set, so `Machine::step` always returns at most one successor.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct StateSet(pub FixedBitSet);

/// Compiled finite automaton: precomputed transition function and
/// epsilon-closures, indexed directly by `StateId` (dense index space sized
/// to the document's state-id capacity — ids are not compacted here; see
/// design D2, compaction only happens on save/export).
#[derive(Debug, Clone)]
pub struct FaEngine {
    capacity: usize,
    pub delta: HashMap<(StateId, SymbolId), SmallVec<[StateId; 2]>>,
    pub eps_closure: Vec<FixedBitSet>,
    pub initial: Option<StateId>,
    pub accepting: FixedBitSet,
}

impl FaEngine {
    pub fn compile(doc: &FaDoc) -> Self {
        let capacity = doc.state_capacity();

        let mut delta: HashMap<(StateId, SymbolId), SmallVec<[StateId; 2]>> = HashMap::new();
        let mut eps_adj: Vec<FixedBitSet> = (0..capacity)
            .map(|_| FixedBitSet::with_capacity(capacity))
            .collect();

        for ((from, to), set) in doc.edges() {
            if set.epsilon {
                eps_adj[from.0 as usize].insert(to.0 as usize);
            }
            for sym in &set.symbols {
                delta.entry((*from, *sym)).or_default().push(*to);
            }
        }

        let eps_closure = compute_eps_closures(capacity, &eps_adj);

        let mut accepting = FixedBitSet::with_capacity(capacity);
        for id in doc.states() {
            if doc.is_accepting(id) {
                accepting.insert(id.0 as usize);
            }
        }

        FaEngine {
            capacity,
            delta,
            eps_closure,
            initial: doc.initial_state(),
            accepting,
        }
    }
}

/// Precompute the epsilon-closure of every state `0..capacity`, including
/// itself. A naive per-state DFS is O(states * (states + edges)) — fine for
/// a handful of epsilon edges, but pathological for a long epsilon chain
/// (every state's closure genuinely contains every state after it, so the
/// DFS re-walks an O(states)-long tail from every starting point).
///
/// Instead: condense epsilon-cycles via Tarjan's SCC (iterative, so a long
/// chain can't blow the stack), then propagate each component's closure
/// through the condensation DAG in the order Tarjan already produces it —
/// reverse topological, sinks first — merging with word-parallel bitset
/// unions instead of re-walking the graph per state. Every state in a
/// component shares that component's closure.
fn compute_eps_closures(capacity: usize, eps_adj: &[FixedBitSet]) -> Vec<FixedBitSet> {
    let adj: Vec<Vec<usize>> = eps_adj.iter().map(|row| row.ones().collect()).collect();
    let (comp_of, comp_order) = tarjan_scc(capacity, &adj);
    let comp_count = comp_order.len();

    let mut comp_members: Vec<Vec<usize>> = vec![Vec::new(); comp_count];
    let mut comp_closure: Vec<FixedBitSet> =
        (0..comp_count).map(|_| FixedBitSet::with_capacity(capacity)).collect();
    for v in 0..capacity {
        comp_members[comp_of[v]].push(v);
        comp_closure[comp_of[v]].insert(v);
    }

    // `comp_order` is sinks-first: by the time component `c` is processed,
    // every component it points to is already final, so this single pass
    // (no fixpoint iteration needed) is correct.
    for &c in &comp_order {
        for &v in &comp_members[c] {
            for &w in &adj[v] {
                let wc = comp_of[w];
                if wc != c {
                    union_two(&mut comp_closure, c, wc);
                }
            }
        }
    }

    (0..capacity).map(|v| comp_closure[comp_of[v]].clone()).collect()
}

/// `closures[dst] |= closures[src]`, without cloning — `split_at_mut` on the
/// two disjoint sides of `dst`/`src` gets both a mutable and a shared
/// borrow into the same slice at once, which plain indexing can't express.
fn union_two(closures: &mut [FixedBitSet], dst: usize, src: usize) {
    debug_assert_ne!(dst, src);
    if dst < src {
        let (left, right) = closures.split_at_mut(src);
        left[dst].union_with(&right[0]);
    } else {
        let (left, right) = closures.split_at_mut(dst);
        right[0].union_with(&left[src]);
    }
}

/// Iterative Tarjan's SCC over `capacity` nodes (`0..capacity`, dense
/// indices) with adjacency list `adj`. Iterative (explicit frame stack, not
/// recursion) so a long epsilon chain — the exact shape that makes this
/// worth doing — can't overflow the call stack.
///
/// Returns `(comp_of, order)`: `comp_of[v]` is `v`'s component id, and
/// `order` lists every component id in completion order, which is
/// guaranteed to be reverse-topological order of the condensation DAG (a
/// component with an edge to another unfinished component can never
/// complete first).
fn tarjan_scc(capacity: usize, adj: &[Vec<usize>]) -> (Vec<usize>, Vec<usize>) {
    const UNVISITED: usize = usize::MAX;
    let mut index_of = vec![UNVISITED; capacity];
    let mut lowlink = vec![0usize; capacity];
    let mut on_stack = vec![false; capacity];
    let mut tstack: Vec<usize> = Vec::new();
    let mut comp_of = vec![UNVISITED; capacity];
    let mut next_index = 0usize;
    let mut next_comp = 0usize;
    let mut comp_order: Vec<usize> = Vec::new();

    // Explicit DFS frames: (node, index of the next neighbor to visit).
    let mut frames: Vec<(usize, usize)> = Vec::new();

    for start in 0..capacity {
        if index_of[start] != UNVISITED {
            continue;
        }
        frames.push((start, 0));
        while !frames.is_empty() {
            let (v, pos) = frames[frames.len() - 1];
            if pos == 0 {
                index_of[v] = next_index;
                lowlink[v] = next_index;
                next_index += 1;
                tstack.push(v);
                on_stack[v] = true;
            }
            if pos < adj[v].len() {
                let w = adj[v][pos];
                frames.last_mut().unwrap().1 += 1;
                if index_of[w] == UNVISITED {
                    frames.push((w, 0));
                } else if on_stack[w] {
                    lowlink[v] = lowlink[v].min(index_of[w]);
                }
            } else {
                frames.pop();
                if let Some(&(parent, _)) = frames.last() {
                    lowlink[parent] = lowlink[parent].min(lowlink[v]);
                }
                if lowlink[v] == index_of[v] {
                    loop {
                        let w = tstack.pop().expect("v's own index is still on tstack");
                        on_stack[w] = false;
                        comp_of[w] = next_comp;
                        if w == v {
                            break;
                        }
                    }
                    comp_order.push(next_comp);
                    next_comp += 1;
                }
            }
        }
    }

    (comp_of, comp_order)
}

impl Machine for FaEngine {
    type Config = StateSet;

    fn start(&self) -> SmallVec<[StateSet; 2]> {
        match self.initial {
            None => SmallVec::new(),
            Some(id) => smallvec![StateSet(self.eps_closure[id.0 as usize].clone())],
        }
    }

    fn step(
        &self,
        cfg: &StateSet,
        input: &[SymbolId],
        at: usize,
    ) -> SmallVec<[(StateSet, usize); 4]> {
        if at >= input.len() {
            return SmallVec::new();
        }
        let symbol = input[at];
        let mut next = FixedBitSet::with_capacity(self.capacity);
        for state_idx in cfg.0.ones() {
            let sid = StateId(state_idx as u32);
            if let Some(targets) = self.delta.get(&(sid, symbol)) {
                for t in targets {
                    next.union_with(&self.eps_closure[t.0 as usize]);
                }
            }
        }
        if next.count_ones(..) == 0 {
            return SmallVec::new();
        }
        smallvec![(StateSet(next), at + 1)]
    }

    fn is_accepting(&self, cfg: &StateSet, at: usize, input: &[SymbolId]) -> bool {
        at == input.len() && cfg.0.ones().any(|i| self.accepting.contains(i))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{run_bounded, Budget, Outcome};
    use crate::model::fa::FaDoc;

    fn word(doc: &FaDoc, symbols: &[&str]) -> Vec<crate::ids::SymbolId> {
        symbols
            .iter()
            .map(|s| doc.symbol_label_to_id(s).expect("symbol must be interned"))
            .collect()
    }

    #[test]
    fn compile_builds_delta_and_eps_closure() {
        let mut doc = FaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 0.0, 0.0).unwrap();
        let q2 = doc.add_state("q2", 0.0, 0.0).unwrap();
        doc.add_epsilon_transition(q0, q1);
        doc.add_transition(q1, q2, "a");
        doc.set_initial(Some(q0));
        doc.set_accepting(q2, true);

        let engine = FaEngine::compile(&doc);

        let a = doc.symbol_label_to_id("a").unwrap();
        // delta[(q1, a)] must reach q2 directly.
        assert_eq!(engine.delta.get(&(q1, a)).map(|v| v.as_slice()), Some(&[q2][..]));
        // eps_closure[q0] must include q0 and q1 (epsilon reachable).
        assert!(engine.eps_closure[q0.0 as usize].contains(q0.0 as usize));
        assert!(engine.eps_closure[q0.0 as usize].contains(q1.0 as usize));
        assert!(!engine.eps_closure[q0.0 as usize].contains(q2.0 as usize));
    }

    #[test]
    fn run_bounded_accepts_via_epsilon_closure() {
        let mut doc = FaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 0.0, 0.0).unwrap();
        let q2 = doc.add_state("q2", 0.0, 0.0).unwrap();
        doc.add_epsilon_transition(q0, q1);
        doc.add_transition(q1, q2, "a");
        doc.set_initial(Some(q0));
        doc.set_accepting(q2, true);

        let engine = FaEngine::compile(&doc);
        let input = word(&doc, &["a"]);
        let trace = run_bounded(&engine, &input, Budget::default());
        assert_eq!(trace.outcome, Outcome::Accepted);
    }

    #[test]
    fn run_bounded_rejects_when_input_exhausted_without_accept() {
        let mut doc = FaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 0.0, 0.0).unwrap();
        doc.add_transition(q0, q1, "a");
        doc.set_initial(Some(q0));
        // q1 is not accepting.

        let engine = FaEngine::compile(&doc);
        let input = word(&doc, &["a"]);
        let trace = run_bounded(&engine, &input, Budget::default());
        assert_eq!(trace.outcome, Outcome::Rejected);
    }

    #[test]
    fn run_bounded_is_stuck_on_missing_transition_mid_string() {
        let mut doc = FaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 0.0, 0.0).unwrap();
        doc.add_transition(q0, q1, "a");
        doc.set_initial(Some(q0));
        doc.set_accepting(q1, true);

        let engine = FaEngine::compile(&doc);
        // 'b' has no transition from q0 at all: dies before consuming the
        // rest of the string.
        let input = word(&doc, &["a"]); // reinterpret: force a symbol with no delta entry below
        let _ = input; // silence unused in case of refactor
        let b = doc.intern_symbol("b");
        let input = vec![b, doc.symbol_label_to_id("a").unwrap()];
        let trace = run_bounded(&engine, &input, Budget::default());
        assert_eq!(trace.outcome, Outcome::Stuck);
    }

    #[test]
    fn run_bounded_truncates_on_step_budget() {
        let mut doc = FaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        doc.add_transition(q0, q0, "a"); // self-loop, never accepts
        doc.set_initial(Some(q0));

        let engine = FaEngine::compile(&doc);
        let a = doc.symbol_label_to_id("a").unwrap();
        let input: Vec<_> = std::iter::repeat_n(a, 50).collect();
        let trace = run_bounded(&engine, &input, Budget { max_steps: 5, max_configs: 5_000 });
        assert_eq!(trace.outcome, Outcome::TruncatedSteps);
    }

    #[test]
    fn perf_smoke_1000_states_10k_input_stays_fast() {
        let mut doc = FaDoc::new();
        let mut prev = doc.add_state("q0", 0.0, 0.0).unwrap();
        doc.set_initial(Some(prev));
        for i in 1..1000 {
            let next = doc.add_state(&format!("q{i}"), 0.0, 0.0).unwrap();
            doc.add_transition(prev, next, "a");
            prev = next;
        }
        doc.add_transition(prev, prev, "a"); // absorb remaining input
        doc.set_accepting(prev, true);

        let engine = FaEngine::compile(&doc);
        let a = doc.symbol_label_to_id("a").unwrap();
        let input: Vec<_> = std::iter::repeat_n(a, 10_000).collect();

        let start = std::time::Instant::now();
        let trace = run_bounded(
            &engine,
            &input,
            Budget { max_steps: 20_000, max_configs: 5_000 },
        );
        let elapsed = start.elapsed();

        assert_eq!(trace.outcome, Outcome::Accepted);
        assert!(
            elapsed.as_secs_f64() < 5.0,
            "1000-state / 10k-char simulation took {elapsed:?}, expected well under 5s"
        );
    }

    #[test]
    fn eps_closure_of_a_cycle_includes_every_member_but_nothing_reached_only_by_a_real_symbol() {
        let mut doc = FaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 0.0, 0.0).unwrap();
        let q2 = doc.add_state("q2", 0.0, 0.0).unwrap();
        let q3 = doc.add_state("q3", 0.0, 0.0).unwrap();
        doc.add_epsilon_transition(q0, q1);
        doc.add_epsilon_transition(q1, q2);
        doc.add_epsilon_transition(q2, q0); // closes the cycle q0 -> q1 -> q2 -> q0
        doc.add_transition(q2, q3, "a"); // only reachable by consuming 'a', not epsilon

        let engine = FaEngine::compile(&doc);
        let closure = &engine.eps_closure[q0.0 as usize];
        assert!(closure.contains(q0.0 as usize));
        assert!(closure.contains(q1.0 as usize));
        assert!(closure.contains(q2.0 as usize));
        assert!(!closure.contains(q3.0 as usize));
        // every member of the cycle must share the exact same closure
        assert_eq!(closure, &engine.eps_closure[q1.0 as usize]);
        assert_eq!(closure, &engine.eps_closure[q2.0 as usize]);
    }

    #[test]
    fn eps_closure_of_a_self_loop_is_just_itself() {
        let mut doc = FaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        doc.add_epsilon_transition(q0, q0);

        let engine = FaEngine::compile(&doc);
        let closure = &engine.eps_closure[q0.0 as usize];
        assert!(closure.contains(q0.0 as usize));
        assert_eq!(closure.count_ones(..), 1);
    }

    #[test]
    fn eps_closure_of_a_long_chain_reaches_every_downstream_state() {
        let mut doc = FaDoc::new();
        let mut prev = doc.add_state("q0", 0.0, 0.0).unwrap();
        let ids: Vec<_> = std::iter::once(prev)
            .chain((1..50).map(|i| {
                let next = doc.add_state(&format!("q{i}"), 0.0, 0.0).unwrap();
                doc.add_epsilon_transition(prev, next);
                prev = next;
                next
            }))
            .collect();

        let engine = FaEngine::compile(&doc);
        let closure = &engine.eps_closure[ids[0].0 as usize];
        for id in &ids {
            assert!(closure.contains(id.0 as usize), "closure of q0 must include {id:?}");
        }
        // the last state's closure must be just itself: nothing further downstream.
        let last_closure = &engine.eps_closure[ids[ids.len() - 1].0 as usize];
        assert_eq!(last_closure.count_ones(..), 1);
    }

    /// Cross-checks `compute_eps_closures` against a deliberately naive,
    /// independent reference (plain BFS over the raw edge list, no SCC, no
    /// bitsets) on random small epsilon graphs — including cycles and
    /// self-loops, which the production algorithm must condense correctly.
    mod eps_closure_matches_naive_reference {
        use super::*;
        use proptest::prelude::*;

        fn naive_closure(n: usize, edges: &[(usize, usize)], start: usize) -> std::collections::BTreeSet<usize> {
            let mut seen = std::collections::BTreeSet::new();
            let mut stack = vec![start];
            seen.insert(start);
            while let Some(v) = stack.pop() {
                for &(from, to) in edges {
                    if from == v && seen.insert(to) {
                        stack.push(to);
                    }
                }
            }
            let _ = n;
            seen
        }

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(256))]

            #[test]
            fn matches(
                n in 2usize..12,
                raw_edges in prop::collection::vec((0usize..12, 0usize..12), 0..20),
            ) {
                let edges: Vec<(usize, usize)> = raw_edges
                    .into_iter()
                    .map(|(f, t)| (f % n, t % n))
                    .collect();

                let mut doc = FaDoc::new();
                let ids: Vec<_> = (0..n).map(|i| doc.add_state(&format!("q{i}"), 0.0, 0.0).unwrap()).collect();
                for &(f, t) in &edges {
                    doc.add_epsilon_transition(ids[f], ids[t]);
                }

                let engine = FaEngine::compile(&doc);

                for (start, id) in ids.iter().enumerate() {
                    let expected = naive_closure(n, &edges, start);
                    let actual: std::collections::BTreeSet<usize> =
                        engine.eps_closure[id.0 as usize].ones().collect();
                    prop_assert_eq!(actual, expected, "mismatch for start state q{}", start);
                }
            }
        }
    }
}
