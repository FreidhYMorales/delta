//! Pushdown-automaton simulation, built on the generic `Machine` trait and
//! `run_bounded` — unlike `engine::mealy`/`engine::moore` (which are
//! deliberately *not* built on `Machine`, since a transducer must be
//! deterministic to mean anything), a PDA is genuinely, unavoidably
//! nondeterministic in general: real JFLAP's own
//! `PDAStepByStateSimulator`/`PDAStepWithClosureSimulator` explore *all*
//! live configurations breadth-first, exactly the shape `Machine`/
//! `run_bounded` already existed for (`engine::mod`'s own doc comment names
//! `(StateId, Stack)` as the anticipated PDA `Config` before any of this was
//! written).
//!
//! Ground truth verified by decompiling real JFLAP's
//! `automata.pda.{PDAConfiguration,PDAStepByStateSimulator,
//! PDAStepWithClosureSimulator,CharacterStack}` with `cfr` (see
//! `model::pda`'s doc comment for the fuller writeup):
//!  - The stack always starts with exactly one fixed symbol pushed (JFLAP
//!    hardcodes the literal `"Z"`), before any input is read.
//!  - Accept mode (final state vs. empty stack) is chosen per simulation
//!    run, never stored on the document — [`AcceptMode`] is a parameter
//!    here, not a `PdaDoc` field.
//!  - `CharacterStack.push(String)` inserts the whole string at the top,
//!    left-to-right; `pop(n)` removes the top `n` characters, top-to-bottom.
//!    `model::pda::PdaTransition`'s `pop`/`push` already store that same
//!    top-to-bottom order — this module's [`Stack`] represents the stack as
//!    a `Vec<SymbolId>` with the **last element as the top** (idiomatic,
//!    O(1) `push`/`pop`), so translating between the two orderings is
//!    exactly the reversal done in [`PdaEngine::step`] below (see its doc
//!    comment for a worked example — this is the single easiest place to
//!    get backwards, so it's covered by dedicated multi-symbol tests).
//!
//! **A shared-engine fix this module's needs surfaced**: `run_bounded`
//! (`engine::mod`) used to stop stepping a config the moment it exhausted
//! the input, which silently drops exactly the epsilon-only continuations
//! (e.g. popping the rest of the stack for empty-stack acceptance) that
//! real JFLAP's own simulator keeps exploring after input ends. Fixed in
//! `engine::mod::run_bounded` itself (still stepped through `FaEngine`
//! unchanged — its `step` already returns nothing past `input.len()`, so
//! nothing about FA's behavior or tests changed).

use std::collections::HashMap;

use smallvec::{smallvec, SmallVec};

use crate::engine::{run_bounded, Budget, Machine, Trace};
use crate::ids::{StateId, SymbolId};
use crate::model::pda::PdaDoc;

/// The runtime stack: `Vec<SymbolId>` with the **last element as the top**.
/// See this module's doc comment for how this relates to
/// `PdaTransition::pop`/`push`'s top-to-bottom string order.
pub type Stack = Vec<SymbolId>;

/// A PDA `Machine::Config`: current state plus the full stack contents.
pub type PdaConfig = (StateId, Stack);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcceptMode {
    FinalState,
    EmptyStack,
}

#[derive(Debug, Clone)]
struct CompiledTransition {
    input: Option<SymbolId>,
    pop: Vec<SymbolId>,
    push: Vec<SymbolId>,
    to: StateId,
}

/// Compiled PDA: transitions grouped by source state (mirrors
/// `FaEngine::compile`'s "precompute once, index directly" approach), plus
/// the accept mode chosen for this run and the interned bottom-of-stack
/// marker symbol.
#[derive(Debug, Clone)]
pub struct PdaEngine {
    by_state: HashMap<StateId, Vec<CompiledTransition>>,
    initial: Option<StateId>,
    accepting: std::collections::HashSet<StateId>,
    /// The symbol pushed once, alone, before simulation begins — real
    /// JFLAP's hardcoded `"Z"`. Looked up from `doc`'s own stack alphabet
    /// (so transitions that explicitly reference `"Z"` in a `pop`/`push`
    /// resolve to the *same* id as this marker); if the document never
    /// interned `"Z"` at all, no transition could ever reference it
    /// anyway, so its exact identity doesn't matter and a synthetic id is
    /// used instead — chosen far outside the dense arena range so it can
    /// never collide with a real interned symbol.
    bottom_marker: SymbolId,
    accept_mode: AcceptMode,
}

const SYNTHETIC_BOTTOM_MARKER: SymbolId = SymbolId(u32::MAX);

impl PdaEngine {
    pub fn compile(doc: &PdaDoc, accept_mode: AcceptMode) -> Self {
        let mut by_state: HashMap<StateId, Vec<CompiledTransition>> = HashMap::new();
        for (_, t) in doc.transitions() {
            by_state.entry(t.from).or_default().push(CompiledTransition {
                input: t.input,
                pop: t.pop.clone(),
                push: t.push.clone(),
                to: t.to,
            });
        }

        let accepting = doc.states().filter(|&s| doc.is_accepting(s)).collect();
        let bottom_marker = doc.stack_symbol_label_to_id("Z").unwrap_or(SYNTHETIC_BOTTOM_MARKER);

        PdaEngine { by_state, initial: doc.initial_state(), accepting, bottom_marker, accept_mode }
    }
}

impl Machine for PdaEngine {
    type Config = PdaConfig;

    fn start(&self) -> SmallVec<[PdaConfig; 2]> {
        match self.initial {
            None => SmallVec::new(),
            Some(id) => smallvec![(id, vec![self.bottom_marker])],
        }
    }

    /// Successors of `cfg` at input position `at`. For each compiled
    /// transition from `cfg`'s state: the input must match (or the
    /// transition is epsilon, which always matches and consumes nothing),
    /// and the stack top must equal `pop` (checked **top-to-bottom against
    /// `pop`, which is the same as bottom-to-top against the tail of the
    /// `Vec`** — worked example: `pop = [B, A]` means "top must be B, then
    /// A below it"; if `stack = [.., A, B]` (`B` last = top), the last two
    /// elements in *stack order* are `[A, B]`, which is `pop` reversed —
    /// hence `pop.iter().rev().eq(...)` below). Pushing mirrors this in
    /// reverse: `push = [X, Y]` means "X ends up on top, Y below it", so
    /// pushing `push.iter().rev()` (`Y` first, then `X`) leaves `X` as the
    /// final (top) element, exactly matching `CharacterStack.push`'s
    /// `buffer.insert(0, string)` semantics.
    fn step(&self, cfg: &PdaConfig, input: &[SymbolId], at: usize) -> SmallVec<[(PdaConfig, usize); 4]> {
        let (state, stack) = cfg;
        let mut out = SmallVec::new();
        let Some(transitions) = self.by_state.get(state) else {
            return out;
        };
        for t in transitions {
            let (consumes, input_matches) = match t.input {
                None => (false, true),
                Some(sym) => (true, at < input.len() && input[at] == sym),
            };
            if !input_matches {
                continue;
            }
            if t.pop.len() > stack.len() {
                continue;
            }
            let top_slice = &stack[stack.len() - t.pop.len()..];
            if !t.pop.iter().rev().eq(top_slice.iter()) {
                continue;
            }

            let mut new_stack = stack[..stack.len() - t.pop.len()].to_vec();
            for &sym in t.push.iter().rev() {
                new_stack.push(sym);
            }

            let new_at = if consumes { at + 1 } else { at };
            out.push(((t.to, new_stack), new_at));
        }
        out
    }

    fn is_accepting(&self, cfg: &PdaConfig, at: usize, input: &[SymbolId]) -> bool {
        if at != input.len() {
            return false;
        }
        let (state, stack) = cfg;
        match self.accept_mode {
            AcceptMode::FinalState => self.accepting.contains(state),
            AcceptMode::EmptyStack => stack.is_empty(),
        }
    }
}

/// Run `doc` on `input` (symbol labels), returning the same `Trace`/
/// `Outcome` vocabulary every other `Machine` produces via `run_bounded`.
/// An unrecognized label (never used in any transition) resolves to a
/// sentinel id that can't match any real transition — matches
/// `word_to_symbols`'s convention in `automata-cli`/`commands::sim`, so CLI
/// and future GUI results agree.
pub fn run_pda(doc: &PdaDoc, input: &[&str], accept_mode: AcceptMode, budget: Budget) -> Trace<PdaConfig> {
    let symbols: Vec<SymbolId> = input
        .iter()
        .enumerate()
        .map(|(i, s)| doc.input_symbol_label_to_id(s).unwrap_or(SymbolId(u32::MAX - 1 - i as u32)))
        .collect();
    let engine = PdaEngine::compile(doc, accept_mode);
    run_bounded(&engine, &symbols, budget)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::Outcome;

    /// `{ a^n b^n : n >= 0 }`-shaped PDA — push one `A` per `a` (state
    /// `q0`), an epsilon move guesses when the `a`-run has ended and
    /// switches to `q1`, then pop one `A` per `b` (state `q1`), plus a
    /// second epsilon move in `q1` that pops the bottom `Z` marker once
    /// it's exposed (only possible once every `A` is gone).
    ///
    /// This construction's accept/reject boundary genuinely differs by
    /// mode, which is the point (a clean way to prove both `AcceptMode`
    /// branches actually run different logic, not just one path with a
    /// no-op flag):
    ///  - **Empty stack**: accepts iff the stack is truly back to `[]`,
    ///    i.e. `Z` was explicitly popped too — reachable only when every
    ///    pushed `A` was matched by a `b`, i.e. exactly `n` `a`s and `n`
    ///    `b`s. This is the actual `a^n b^n` language.
    ///  - **Final state**: accepts as soon as `q1` is reached with the
    ///    input fully consumed, *regardless of leftover stack content* —
    ///    q1 is reachable after consuming any prefix-worth of `b`s once the
    ///    `a`-run is done, so this mode accepts the strictly larger
    ///    language `{ a^n b^m : 0 <= m <= n }`.
    fn a_to_the_n_b_to_the_n() -> PdaDoc {
        let mut doc = PdaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        doc.set_initial(Some(q0));
        doc.set_accepting(q1, true);

        let a = doc.intern_input_symbol("a");
        let b = doc.intern_input_symbol("b");
        let sym_a = doc.intern_stack_symbol("A");
        let z = doc.intern_stack_symbol("Z");

        doc.add_transition(q0, q0, Some(a), vec![], vec![sym_a]); // push A per 'a'
        doc.add_transition(q0, q1, None, vec![], vec![]); // guess: a-run is over
        doc.add_transition(q1, q1, Some(b), vec![sym_a], vec![]); // pop A per 'b'
        doc.add_transition(q1, q1, None, vec![z], vec![]); // pop the bottom Z once exposed

        doc
    }

    fn outcome(doc: &PdaDoc, input: &[&str], mode: AcceptMode) -> Outcome {
        run_pda(doc, input, mode, Budget::default()).outcome
    }

    #[test]
    fn empty_input_accepts_under_both_modes() {
        // 0 a's = 0 b's is a trivial base case of the language, so both
        // modes agree here (unlike the unbalanced case below, where they
        // genuinely differ): q0 -eps-> q1 with input already exhausted
        // (q1 is final -> accepts under final-state), and since the
        // Z-popping epsilon move only cares about the stack top — never
        // about remaining input length — it can *still* fire even though
        // input is already exhausted, reaching an empty stack too. This is
        // exactly the case that exercises the `run_bounded` fix noted in
        // this module's doc comment: without it, an already-exhausted
        // config never gets stepped again, so this epsilon move would
        // never fire and empty-stack mode would wrongly reject "" (0 a's,
        // 0 b's is trivially balanced, so it must accept).
        let doc = a_to_the_n_b_to_the_n();
        assert_eq!(outcome(&doc, &[], AcceptMode::FinalState), Outcome::Accepted);
        assert_eq!(outcome(&doc, &[], AcceptMode::EmptyStack), Outcome::Accepted);
    }

    #[test]
    fn balanced_ab_accepts_under_both_modes() {
        let doc = a_to_the_n_b_to_the_n();
        assert_eq!(outcome(&doc, &["a", "b"], AcceptMode::FinalState), Outcome::Accepted);
        assert_eq!(outcome(&doc, &["a", "b"], AcceptMode::EmptyStack), Outcome::Accepted);
    }

    #[test]
    fn balanced_aabb_accepts_under_both_modes() {
        let doc = a_to_the_n_b_to_the_n();
        assert_eq!(outcome(&doc, &["a", "a", "b", "b"], AcceptMode::FinalState), Outcome::Accepted);
        assert_eq!(outcome(&doc, &["a", "a", "b", "b"], AcceptMode::EmptyStack), Outcome::Accepted);
    }

    #[test]
    fn unbalanced_more_as_than_bs_accepts_final_state_but_not_empty_stack() {
        let doc = a_to_the_n_b_to_the_n();
        // "aab": q1 reached with input exhausted (one A left on the
        // stack) — final-state mode only cares about the state, so it
        // accepts; empty-stack mode correctly rejects since a leftover A
        // means the stack can never reach [].
        assert_eq!(outcome(&doc, &["a", "a", "b"], AcceptMode::FinalState), Outcome::Accepted);
        assert_eq!(outcome(&doc, &["a", "a", "b"], AcceptMode::EmptyStack), Outcome::Rejected);
    }

    #[test]
    fn more_bs_than_as_is_stuck_under_both_modes() {
        let doc = a_to_the_n_b_to_the_n();
        // "ab" consumes cleanly (see above); the second 'b' in "abb" has
        // nothing left to pop (every A already gone) and q1 has no other
        // transition for 'b' once the stack no longer starts with A, so
        // this dies before the input is fully consumed.
        assert_eq!(outcome(&doc, &["a", "b", "b"], AcceptMode::FinalState), Outcome::Stuck);
        assert_eq!(outcome(&doc, &["a", "b", "b"], AcceptMode::EmptyStack), Outcome::Stuck);
    }

    #[test]
    fn no_initial_state_is_stuck_immediately() {
        let mut doc = PdaDoc::new();
        doc.add_state("q0", 0.0, 0.0).unwrap();
        assert_eq!(outcome(&doc, &["a"], AcceptMode::FinalState), Outcome::Stuck);
    }

    #[test]
    fn an_unrecognized_symbol_cannot_match_any_transition() {
        let doc = a_to_the_n_b_to_the_n();
        assert_eq!(outcome(&doc, &["z"], AcceptMode::FinalState), Outcome::Stuck);
    }

    /// Directly exercises the `pop`/`push` top-to-bottom-vs-stack-top
    /// reversal called out in `step`'s doc comment, independent of the
    /// a^n b^n fixture: pop two symbols in one shot (`pop = [B, A]`, top
    /// must be B then A) and push two in one shot (`push = [X, Y]`, X ends
    /// up on top) from a hand-built stack.
    #[test]
    fn multi_symbol_pop_and_push_respect_top_to_bottom_order() {
        let mut doc = PdaDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        doc.set_initial(Some(q0));
        doc.set_accepting(q1, true);
        let c = doc.intern_input_symbol("c");
        let sym_a = doc.intern_stack_symbol("A");
        let sym_b = doc.intern_stack_symbol("B");
        let sym_x = doc.intern_stack_symbol("X");
        let sym_y = doc.intern_stack_symbol("Y");
        // pop [B, A] (top=B, then A), push [X, Y] (X ends up on top).
        doc.add_transition(q0, q1, Some(c), vec![sym_b, sym_a], vec![sym_x, sym_y]);

        let engine = PdaEngine::compile(&doc, AcceptMode::FinalState);
        // Runtime stack, last = top: bottom .. A, B (B is top, matches pop[0]).
        let start_stack: Stack = vec![sym_a, sym_b];
        let successors = engine.step(&(q0, start_stack), &[c], 0);
        assert_eq!(successors.len(), 1);
        let ((to, stack), at) = &successors[0];
        assert_eq!(*to, q1);
        assert_eq!(*at, 1);
        // popped A,B off; pushed X,Y such that X is the new top (last elem).
        assert_eq!(stack, &vec![sym_y, sym_x]);
    }
}
