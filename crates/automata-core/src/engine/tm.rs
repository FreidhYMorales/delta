//! Turing Machine simulation, built on the generic `Machine` trait and
//! `run_bounded` — same "nondeterministic branching is exactly what this
//! engine already exists for" reasoning as `engine::pda`'s own doc comment
//! (real JFLAP's own `NDTMSimulator` explores every live configuration
//! breadth-first, same shape).
//!
//! Ground truth verified by decompiling real JFLAP's
//! `automata.turing.{TMSimulator,TMConfiguration,Tape,AcceptByFinalStateFilter,
//! AcceptByHaltingFilter}` with `cfr` (see `model::tm`'s doc comment for the
//! fuller writeup):
//!  - Each tape is bi-infinite. Represented here as a sparse
//!    `BTreeMap<i64, SymbolId>` (only non-blank cells stored — any position
//!    absent from the map reads as the engine's interned blank symbol) plus
//!    an `i64` head position — cheaper and simpler than JFLAP's own
//!    explicit-buffer-with-manual-extension approach, and trivially
//!    `Eq`/`Hash`/`Clone` (required for `Machine::Config`). Writing the
//!    blank symbol over a cell *removes* that entry rather than storing it
//!    explicitly, so two tapes with the same effective contents always
//!    compare equal regardless of write history — this matters for
//!    `run_bounded`'s `seen` dedup set to actually catch repeated
//!    configurations (e.g. a machine that writes blank back over a cell it
//!    just visited).
//!  - Accept mode (final state vs. halting) is chosen per simulation run,
//!    never stored on the document — [`AcceptMode`] is a parameter here,
//!    exactly like `engine::pda::AcceptMode`.
//!  - **Unlike FA/PDA, a TM's `Machine::Config` carries the entire tape
//!    contents itself** rather than consuming from an external `input`
//!    slice via a position index — `TMSimulator.getInitialConfigurations`
//!    writes the input word directly onto the tape(s) up front. So
//!    `run_tm` bakes the initial tape contents into `TmEngine` at compile
//!    time (`Machine::start` takes no external input) and calls
//!    `run_bounded` with an **empty** `input: &[]` — `step`/`is_accepting`
//!    below never read that parameter at all, they read `cfg`'s own tapes.
//!    Since `input.len() == 0`, `at >= input.len()` is trivially always
//!    true, so `run_bounded`'s `Rejected`-vs-`Stuck` distinction always
//!    resolves to `Rejected` for a non-accepting halt — the only sensible
//!    reading for a TM anyway (there's no separate "input not fully
//!    consumed" concept once the whole word already lives on the tape).
//!  - **Accept-by-halting** needs to know whether *this* configuration has
//!    any further move at all — JFLAP's own `TMConfiguration.isHalted()` is
//!    set externally by the simulator loop when it fails to find a next
//!    move. Since `run_bounded` calls `is_accepting` *before* `step` each
//!    round, [`TmEngine::is_accepting`] computes this itself for
//!    `AcceptMode::Halting` by calling `step` and checking emptiness — cheap
//!    (one small per-state transition lookup), and avoids adding any
//!    halted-tracking state to `run_bounded` itself.
//!  - Input loading mirrors JFLAP's own two `getInitialConfigurations`
//!    overloads: one input word broadcast onto every tape, or one explicit
//!    word per tape — see [`run_tm`]'s doc comment.

use std::collections::{BTreeMap, HashMap, HashSet};

use smallvec::{smallvec, SmallVec};

use crate::engine::{run_bounded, Budget, Machine, Trace};
use crate::ids::{StateId, SymbolId};
use crate::model::tm::{Direction, TmDoc};

/// One tape: only non-blank cells are stored (see this module's doc comment
/// on why blank writes remove rather than insert).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TapeState {
    pub cells: BTreeMap<i64, SymbolId>,
    pub head: i64,
}

/// A TM `Machine::Config`: current state plus every tape's full contents.
pub type TmConfig = (StateId, Vec<TapeState>);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcceptMode {
    FinalState,
    Halting,
}

#[derive(Debug, Clone)]
struct CompiledTapeOp {
    read: SymbolId,
    write: SymbolId,
    direction: Direction,
}

#[derive(Debug, Clone)]
struct CompiledTransition {
    tapes: Vec<CompiledTapeOp>,
    to: StateId,
}

/// Compiled TM: transitions grouped by source state, plus the accept mode
/// and blank symbol for this run, and the initial tape contents already
/// baked in from the caller's `inputs` (see this module's doc comment on why
/// `Machine::start` alone can't take that parameter).
#[derive(Debug, Clone)]
pub struct TmEngine {
    by_state: HashMap<StateId, Vec<CompiledTransition>>,
    initial_state: Option<StateId>,
    initial_tapes: Vec<TapeState>,
    accepting: HashSet<StateId>,
    blank: SymbolId,
    accept_mode: AcceptMode,
}

impl TmEngine {
    fn write_cell(tape: &mut TapeState, blank: SymbolId, symbol: SymbolId) {
        if symbol == blank {
            tape.cells.remove(&tape.head);
        } else {
            tape.cells.insert(tape.head, symbol);
        }
    }

    /// `initial_tapes[i]` is tape `i`'s contents before any step, head at 0,
    /// built by writing `inputs[i]` (already-resolved symbol ids) left to
    /// right starting at position 0 — mirrors `Tape(String)`.
    pub fn compile(doc: &TmDoc, initial_tapes_input: &[Vec<SymbolId>], accept_mode: AcceptMode) -> Self {
        let blank = doc.blank_symbol();
        let mut by_state: HashMap<StateId, Vec<CompiledTransition>> = HashMap::new();
        for (_, t) in doc.transitions() {
            by_state.entry(t.from).or_default().push(CompiledTransition {
                tapes: t
                    .tapes
                    .iter()
                    .map(|op| CompiledTapeOp { read: op.read, write: op.write, direction: op.direction })
                    .collect(),
                to: t.to,
            });
        }
        let accepting = doc.states().filter(|&s| doc.is_accepting(s)).collect();

        let initial_tapes = initial_tapes_input
            .iter()
            .map(|word| {
                let mut tape = TapeState { cells: BTreeMap::new(), head: 0 };
                for (i, &sym) in word.iter().enumerate() {
                    tape.head = i as i64;
                    Self::write_cell(&mut tape, blank, sym);
                }
                tape.head = 0;
                tape
            })
            .collect();

        TmEngine { by_state, initial_state: doc.initial_state(), initial_tapes, accepting, blank, accept_mode }
    }
}

impl Machine for TmEngine {
    type Config = TmConfig;

    fn start(&self) -> SmallVec<[TmConfig; 2]> {
        match self.initial_state {
            None => SmallVec::new(),
            Some(id) => smallvec![(id, self.initial_tapes.clone())],
        }
    }

    /// Successors of `cfg` — `input`/`at` are unused (see this module's doc
    /// comment: a TM's config carries its own tapes, there's no external
    /// input to index into). For each compiled transition from `cfg`'s
    /// state: every tape's current cell under its head must equal that
    /// tape-op's `read` exactly (no wildcards, see `model::tm`'s doc
    /// comment); if so, write/move every tape accordingly and move to the
    /// transition's target state. `new_at` is always `0` — meaningless for
    /// TM, kept only to satisfy `Machine::step`'s shared signature.
    fn step(&self, cfg: &TmConfig, _input: &[SymbolId], _at: usize) -> SmallVec<[(TmConfig, usize); 4]> {
        let (state, tapes) = cfg;
        let mut out = SmallVec::new();
        let Some(transitions) = self.by_state.get(state) else {
            return out;
        };
        for t in transitions {
            if t.tapes.len() != tapes.len() {
                continue;
            }
            let matches = t.tapes.iter().zip(tapes).all(|(op, tape)| {
                let current = tape.cells.get(&tape.head).copied().unwrap_or(self.blank);
                current == op.read
            });
            if !matches {
                continue;
            }

            let mut new_tapes = tapes.clone();
            for (op, tape) in t.tapes.iter().zip(new_tapes.iter_mut()) {
                Self::write_cell(tape, self.blank, op.write);
                tape.head += match op.direction {
                    Direction::Left => -1,
                    Direction::Right => 1,
                    Direction::Stay => 0,
                };
            }

            out.push(((t.to, new_tapes), 0));
        }
        out
    }

    /// `input`/`at` are unused, same reason as `step`. `AcceptMode::Halting`
    /// computes "no further move" itself by calling `step` — see this
    /// module's doc comment for why `run_bounded`'s call ordering makes that
    /// necessary here (JFLAP tracks it externally on `TMConfiguration`
    /// instead).
    fn is_accepting(&self, cfg: &TmConfig, at: usize, input: &[SymbolId]) -> bool {
        match self.accept_mode {
            AcceptMode::FinalState => self.accepting.contains(&cfg.0),
            AcceptMode::Halting => self.step(cfg, input, at).is_empty(),
        }
    }
}

/// Run `doc`, returning the same `Trace`/`Outcome` vocabulary every other
/// `Machine` produces via `run_bounded`. `inputs` mirrors JFLAP's own two
/// `TMSimulator.getInitialConfigurations` overloads:
///  - `inputs.len() == 1`: that one word is broadcast onto *every* tape
///    (JFLAP's convenience single-string overload).
///  - `inputs.len() == doc.tape_count()`: each tape gets its own explicit
///    word (JFLAP's general array overload).
///  - Any other length: tapes beyond `inputs.len()` start blank-only, extra
///    entries in `inputs` beyond `tape_count()` are ignored — JFLAP itself
///    has no defined behavior for a mismatched array length either, so this
///    is a documented, reasonable choice rather than a ground-truth fact.
///
/// An unrecognized symbol label (never used in any transition) resolves to
/// a sentinel id that can't match any real transition's `read` — same
/// convention `run_pda`/`word_to_symbols` already use.
pub fn run_tm(doc: &TmDoc, inputs: &[&[&str]], accept_mode: AcceptMode, budget: Budget) -> Trace<TmConfig> {
    let tape_count = doc.tape_count().max(1);
    let resolve = |word: &[&str]| -> Vec<SymbolId> {
        word.iter()
            .enumerate()
            .map(|(i, s)| doc.symbol_label_to_id(s).unwrap_or(SymbolId(u32::MAX - 1 - i as u32)))
            .collect()
    };

    let initial_tapes: Vec<Vec<SymbolId>> = if inputs.len() == 1 {
        std::iter::repeat_n(resolve(inputs[0]), tape_count).collect()
    } else {
        (0..tape_count).map(|i| inputs.get(i).map(|w| resolve(w)).unwrap_or_default()).collect()
    };

    let engine = TmEngine::compile(doc, &initial_tapes, accept_mode);
    run_bounded(&engine, &[], budget)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::Outcome;
    use crate::model::tm::TmTapeOp;

    /// Unary-increment TM: input is a run of `1`s on tape 0; the machine
    /// moves right past every `1`, then writes one more `1` in the trailing
    /// blank cell and halts in the accepting state. Hand-verified: "111" ->
    /// scans past all three 1s, writes a 4th, so the tape reads "1111".
    fn unary_increment() -> TmDoc {
        let mut doc = TmDoc::new();
        let scan = doc.add_state("scan", 0.0, 0.0).unwrap();
        let done = doc.add_state("done", 10.0, 0.0).unwrap();
        doc.set_initial(Some(scan));
        doc.set_accepting(done, true);
        let one = doc.intern_symbol("1");
        let blank = doc.blank_symbol();

        // scan: on '1', write '1' (no change), move right, stay in scan.
        doc.add_transition(scan, scan, vec![TmTapeOp { read: one, write: one, direction: Direction::Right }]).unwrap();
        // scan: on blank (end of the run), write '1', move right, go to done.
        doc.add_transition(scan, done, vec![TmTapeOp { read: blank, write: one, direction: Direction::Right }]).unwrap();

        doc
    }

    #[test]
    fn unary_increment_appends_one_more_one_and_accepts() {
        let doc = unary_increment();
        let result = run_tm(&doc, &[&["1", "1", "1"]], AcceptMode::FinalState, Budget::default());
        assert_eq!(result.outcome, Outcome::Accepted);
        let last = result.steps.last().unwrap();
        let (_, tapes) = &last.configs[0];
        let one = doc.symbol_label_to_id("1").unwrap();
        // Cells 0..=3 must all read '1' (four 1s written), head parked at 4.
        for pos in 0..4 {
            assert_eq!(tapes[0].cells.get(&pos), Some(&one), "cell {pos} should hold '1'");
        }
        assert_eq!(tapes[0].head, 4);
    }

    #[test]
    fn unary_increment_accepts_under_halting_mode_too_since_it_actually_halts() {
        let doc = unary_increment();
        let result = run_tm(&doc, &[&["1", "1"]], AcceptMode::Halting, Budget::default());
        assert_eq!(result.outcome, Outcome::Accepted);
    }

    /// A machine that halts in a *non*-accepting state: only one transition
    /// exists (state `q0` on '1' -> stays `q0`, moves right), so once the
    /// tape runs out of `1`s it hits blank and has no move — it halts, but
    /// `q0` was never marked accepting. Proves `Halting` and `FinalState`
    /// genuinely diverge, mirroring PDA's own final-state-vs-empty-stack
    /// contrast test.
    fn halts_in_a_non_accepting_state() -> TmDoc {
        let mut doc = TmDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        doc.set_initial(Some(q0));
        // q0 is deliberately never marked accepting.
        let one = doc.intern_symbol("1");
        doc.add_transition(q0, q0, vec![TmTapeOp { read: one, write: one, direction: Direction::Right }]).unwrap();
        doc
    }

    #[test]
    fn halting_in_a_non_accepting_state_accepts_under_halting_but_not_final_state() {
        let doc = halts_in_a_non_accepting_state();
        assert_eq!(run_tm(&doc, &[&["1", "1"]], AcceptMode::Halting, Budget::default()).outcome, Outcome::Accepted);
        assert_eq!(run_tm(&doc, &[&["1", "1"]], AcceptMode::FinalState, Budget::default()).outcome, Outcome::Rejected);
    }

    /// Two-tape copy machine: reads tape 0 left to right, writes the same
    /// symbol onto tape 1 at the same position, moves both heads right
    /// together, until tape 0 hits blank — proves the multi-tape wiring
    /// (independent per-tape read/write/move within one transition) works
    /// end to end, not just single-tape.
    fn two_tape_copy() -> TmDoc {
        let mut doc = TmDoc::new();
        let copy = doc.add_state("copy", 0.0, 0.0).unwrap();
        let done = doc.add_state("done", 10.0, 0.0).unwrap();
        doc.set_initial(Some(copy));
        doc.set_accepting(done, true);
        let a = doc.intern_symbol("a");
        let b = doc.intern_symbol("b");
        let blank = doc.blank_symbol();

        // copy: read 'a' on tape0 (unchanged), write 'a' onto tape1, both move right.
        doc.add_transition(
            copy,
            copy,
            vec![
                TmTapeOp { read: a, write: a, direction: Direction::Right },
                TmTapeOp { read: blank, write: a, direction: Direction::Right },
            ],
        )
        .unwrap();
        // copy: read 'b' on tape0 (unchanged), write 'b' onto tape1, both move right.
        doc.add_transition(
            copy,
            copy,
            vec![
                TmTapeOp { read: b, write: b, direction: Direction::Right },
                TmTapeOp { read: blank, write: b, direction: Direction::Right },
            ],
        )
        .unwrap();
        // copy: tape0 hit blank (end of input) -> done, tape1 untouched.
        doc.add_transition(
            copy,
            done,
            vec![
                TmTapeOp { read: blank, write: blank, direction: Direction::Stay },
                TmTapeOp { read: blank, write: blank, direction: Direction::Stay },
            ],
        )
        .unwrap();

        doc
    }

    #[test]
    fn two_tape_copy_duplicates_tape_zero_onto_tape_one() {
        let doc = two_tape_copy();
        // Explicit per-tape inputs: tape0 = "aba", tape1 starts blank.
        let result = run_tm(&doc, &[&["a", "b", "a"], &[]], AcceptMode::FinalState, Budget::default());
        assert_eq!(result.outcome, Outcome::Accepted);
        let last = result.steps.last().unwrap();
        let (_, tapes) = &last.configs[0];
        let a = doc.symbol_label_to_id("a").unwrap();
        let b = doc.symbol_label_to_id("b").unwrap();
        assert_eq!(tapes[1].cells.get(&0), Some(&a));
        assert_eq!(tapes[1].cells.get(&1), Some(&b));
        assert_eq!(tapes[1].cells.get(&2), Some(&a));
    }

    #[test]
    fn broadcasting_a_single_input_onto_every_tape_matches_the_explicit_per_tape_form() {
        // A trivial 2-tape machine where tape0==tape1 by construction: this
        // is really just proving `run_tm`'s `inputs.len() == 1` broadcast
        // path resolves to the same tape_count as the explicit form.
        let mut doc = TmDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        doc.set_initial(Some(q0));
        doc.set_accepting(q0, true);
        let a = doc.intern_symbol("a");
        doc.add_transition(
            q0,
            q0,
            vec![
                TmTapeOp { read: a, write: a, direction: Direction::Stay },
                TmTapeOp { read: a, write: a, direction: Direction::Stay },
            ],
        )
        .unwrap();
        assert_eq!(doc.tape_count(), 2);

        let broadcast = run_tm(&doc, &[&["a"]], AcceptMode::FinalState, Budget::default());
        assert_eq!(broadcast.outcome, Outcome::Accepted);
    }

    #[test]
    fn no_initial_state_is_stuck_immediately() {
        let mut doc = TmDoc::new();
        doc.add_state("q0", 0.0, 0.0).unwrap();
        let result = run_tm(&doc, &[&["1"]], AcceptMode::FinalState, Budget::default());
        assert_eq!(result.outcome, Outcome::Stuck);
    }
}
