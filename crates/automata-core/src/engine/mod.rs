//! Generic stepping engine: the `Machine` trait, bounded simulation driver,
//! and trace/outcome types shared by every machine kind. See design D1/D3.
//!
//! `Machine::step` returns a *set* of successors and `run_bounded` keeps a
//! hash-deduped frontier. FA collapses nondeterminism inside its `Config`
//! (the whole epsilon-closed subset), so FA's `step` returns exactly one
//! successor; PDA/TM return 0..n branches that cannot collapse.
//! `run_bounded`, budgets, truncation, and trace shape are written once here
//! and reused by every machine kind.

use std::collections::HashSet;
use std::hash::Hash;

use smallvec::SmallVec;

use crate::ids::SymbolId;

/// A steppable machine. `Config` is the per-kind configuration: for FA, a
/// state set (bitset); for PDA, `(StateId, Stack)` (`engine::pda::PdaConfig`);
/// for TM, `(StateId, Vec<TapeState>)` (`engine::tm::TmConfig`) — one full
/// tape per position, not the `(StateId, Tape, i64)` single-tape shape this
/// comment originally anticipated, since real JFLAP's own `TuringMachine` is
/// genuinely multi-tape from its base model (see `model::tm`'s doc comment).
pub trait Machine {
    type Config: Clone + Eq + Hash;

    /// The initial configuration(s) before any input is consumed.
    fn start(&self) -> SmallVec<[Self::Config; 2]>;

    /// Successors of `cfg` reading from position `at` in `input`. The
    /// returned `usize` is the new input position (TM/epsilon moves may
    /// consume 0 symbols). Returns no successors when `cfg` is a dead end.
    fn step(
        &self,
        cfg: &Self::Config,
        input: &[SymbolId],
        at: usize,
    ) -> SmallVec<[(Self::Config, usize); 4]>;

    /// Whether `cfg` at position `at` is an accepting configuration.
    fn is_accepting(&self, cfg: &Self::Config, at: usize, input: &[SymbolId]) -> bool;
}

/// Bounds a simulation run so pathological inputs (e.g. epsilon loops, or
/// branching PDA/TM configs) cannot hang or exhaust memory.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Budget {
    pub max_steps: usize,
    pub max_configs: usize,
}

impl Default for Budget {
    fn default() -> Self {
        Budget {
            max_steps: 10_000,
            max_configs: 5_000,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Accepted,
    Rejected,
    Stuck,
    TruncatedSteps,
    TruncatedConfigs,
}

/// The set of live configurations at one round of the simulation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StepRecord<C> {
    pub configs: Vec<C>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Trace<C> {
    pub outcome: Outcome,
    pub steps: Vec<StepRecord<C>>,
}

/// Run `m` over `input`, bounded by `budget`. See [`Outcome`] for the
/// possible terminal states.
///
/// Distinguishes `Rejected` (every live branch fully consumed the input
/// without reaching an accepting configuration) from `Stuck` (every branch
/// died before the input was fully consumed — e.g. a DFA with no transition
/// for the current symbol).
pub fn run_bounded<M: Machine>(m: &M, input: &[SymbolId], budget: Budget) -> Trace<M::Config> {
    let mut frontier: Vec<(M::Config, usize)> =
        m.start().into_iter().map(|c| (c, 0)).collect();
    let mut steps: Vec<StepRecord<M::Config>> = Vec::new();
    let mut step_count = 0usize;

    loop {
        steps.push(StepRecord {
            configs: frontier.iter().map(|(c, _)| c.clone()).collect(),
        });

        if frontier
            .iter()
            .any(|(c, at)| m.is_accepting(c, *at, input))
        {
            return Trace {
                outcome: Outcome::Accepted,
                steps,
            };
        }

        let mut any_exhausted = false;
        let mut seen: HashSet<(M::Config, usize)> = HashSet::new();
        let mut next: Vec<(M::Config, usize)> = Vec::new();

        // Always step every live config, even one that has already
        // exhausted the input: a machine whose `step` can consume zero
        // symbols (epsilon moves — PDA stack-only pops, future TM) may still
        // have useful zero-consuming transitions to take *after* input ends
        // (e.g. a PDA popping its stack down to empty for empty-stack
        // acceptance once there's nothing left to read). A machine that only
        // ever consumes real symbols (FA) already guards this itself —
        // `FaEngine::step` returns no successors once `at >= input.len()` —
        // so this costs those machines nothing beyond one guarded call.
        // `any_exhausted` still needs to be tracked independently of
        // whether `step` found further work, to keep the Rejected-vs-Stuck
        // distinction below meaningful.
        for (cfg, at) in &frontier {
            if *at >= input.len() {
                any_exhausted = true;
            }
            for (ncfg, nat) in m.step(cfg, input, *at) {
                if seen.insert((ncfg.clone(), nat)) {
                    next.push((ncfg, nat));
                }
            }
        }

        if next.is_empty() {
            let outcome = if any_exhausted {
                Outcome::Rejected
            } else {
                Outcome::Stuck
            };
            return Trace { outcome, steps };
        }

        if step_count >= budget.max_steps {
            return Trace {
                outcome: Outcome::TruncatedSteps,
                steps,
            };
        }
        if next.len() > budget.max_configs {
            return Trace {
                outcome: Outcome::TruncatedConfigs,
                steps,
            };
        }

        frontier = next;
        step_count += 1;
    }
}

pub mod fa;
pub mod mealy;
pub mod moore;
pub mod pda;
pub mod tm;
