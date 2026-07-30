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

        let eps_closure: Vec<FixedBitSet> = (0..capacity)
            .map(|idx| eps_closure_of(idx, &eps_adj, capacity))
            .collect();

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

/// Depth-first epsilon-closure of a single state, including itself.
fn eps_closure_of(start: usize, eps_adj: &[FixedBitSet], capacity: usize) -> FixedBitSet {
    let mut closure = FixedBitSet::with_capacity(capacity);
    let mut stack = vec![start];
    closure.insert(start);
    while let Some(s) = stack.pop() {
        for t in eps_adj[s].ones() {
            if !closure.contains(t) {
                closure.insert(t);
                stack.push(t);
            }
        }
    }
    closure
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
}
