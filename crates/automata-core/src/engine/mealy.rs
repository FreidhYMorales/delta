//! Mealy machine simulation — deliberately NOT built on the `Machine`
//! trait/`run_bounded` (`engine/mod.rs`) the way FA's engine is. That
//! machinery exists for **accept/reject** outcomes over a *set* of
//! branching configurations (FA collapses its set into one bitset `Config`;
//! a future PDA/TM would keep 0..n live branches). Mealy simulation isn't
//! shaped like that at all: the whole point of running one is the output
//! string it produces, and a Mealy machine is required to be deterministic
//! to mean anything as a synchronous transducer (one input symbol in, one
//! output symbol out — see `model::mealy`'s doc comment). So this steps
//! through exactly one live state at a time and *reports* nondeterminism as
//! a stuck outcome instead of branching to explore it — no frontier, no
//! budget, no bitsets needed.

use crate::ids::{StateId, SymbolId};
use crate::model::mealy::MealyDoc;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MealyOutcome {
    /// Every input symbol had exactly one matching transition; one output
    /// symbol per input symbol consumed, in order.
    Completed(Vec<String>),
    /// `doc` has no initial state.
    NoInitialState,
    /// Stuck at 0-indexed input position `at`: no transition matches (either
    /// the symbol was never used as an input anywhere, or this specific
    /// state just doesn't have one for it).
    NoTransition { at: usize },
    /// Stuck at 0-indexed input position `at`: more than one transition
    /// matches (`doc` is nondeterministic at this state/symbol — see
    /// `MealyDoc::is_deterministic`) — reading further would be ambiguous,
    /// so simulation stops rather than silently picking a branch.
    Ambiguous { at: usize },
}

/// Run `doc` on `input` (symbol labels, resolved against `doc`'s own input
/// alphabet — an unrecognized label is indistinguishable from "no
/// transition for this symbol here", since neither can ever match).
pub fn run_mealy(doc: &MealyDoc, input: &[&str]) -> MealyOutcome {
    let Some(mut state) = doc.initial_state() else {
        return MealyOutcome::NoInitialState;
    };
    let mut outputs = Vec::with_capacity(input.len());
    for (i, &symbol_label) in input.iter().enumerate() {
        let Some(symbol) = doc.input_symbol_label_to_id(symbol_label) else {
            return MealyOutcome::NoTransition { at: i };
        };
        let matches: Vec<(StateId, SymbolId)> = doc
            .edges()
            .filter(|((from, _), _)| *from == state)
            .filter_map(|((_, to), transitions)| transitions.get(&symbol).map(|&out| (*to, out)))
            .collect();
        match matches.as_slice() {
            [] => return MealyOutcome::NoTransition { at: i },
            [(next, out)] => {
                outputs.push(doc.output_symbol_label(*out).expect("interned output has a label").to_string());
                state = *next;
            }
            _ => return MealyOutcome::Ambiguous { at: i },
        }
    }
    MealyOutcome::Completed(outputs)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The textbook "output the running count of 1s mod 2 as a/b" style
    /// binary-parity Mealy machine: q0 -[0/a]-> q0, q0 -[1/b]-> q1,
    /// q1 -[0/a]-> q1, q1 -[1/b]-> q0.
    fn parity_machine() -> MealyDoc {
        let mut doc = MealyDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        doc.set_initial(Some(q0));
        doc.add_transition(q0, q0, "0", "a");
        doc.add_transition(q0, q1, "1", "b");
        doc.add_transition(q1, q1, "0", "a");
        doc.add_transition(q1, q0, "1", "b");
        doc
    }

    #[test]
    fn empty_input_produces_empty_output_without_consuming_anything() {
        assert_eq!(run_mealy(&parity_machine(), &[]), MealyOutcome::Completed(vec![]));
    }

    #[test]
    fn produces_one_output_symbol_per_input_symbol_in_order() {
        let outcome = run_mealy(&parity_machine(), &["1", "0", "1", "1"]);
        assert_eq!(outcome, MealyOutcome::Completed(vec!["b".into(), "a".into(), "b".into(), "b".into()]));
    }

    #[test]
    fn no_initial_state_is_reported_directly_not_as_a_stuck_position() {
        let mut doc = MealyDoc::new();
        doc.add_state("q0", 0.0, 0.0).unwrap();
        assert_eq!(run_mealy(&doc, &["0"]), MealyOutcome::NoInitialState);
    }

    #[test]
    fn an_unrecognized_symbol_is_a_no_transition_stuck_outcome_at_its_position() {
        let outcome = run_mealy(&parity_machine(), &["0", "z"]);
        assert_eq!(outcome, MealyOutcome::NoTransition { at: 1 });
    }

    #[test]
    fn a_state_missing_a_transition_for_an_otherwise_valid_symbol_is_stuck_there() {
        let mut doc = MealyDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        doc.set_initial(Some(q0));
        doc.add_transition(q0, q1, "a", "x"); // only defines "a" as a symbol anywhere
        assert_eq!(run_mealy(&doc, &["a", "a"]), MealyOutcome::NoTransition { at: 1 });
    }

    #[test]
    fn a_nondeterministic_machine_reports_ambiguous_instead_of_picking_a_branch() {
        let mut doc = MealyDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        let q2 = doc.add_state("q2", 10.0, 10.0).unwrap();
        doc.set_initial(Some(q0));
        doc.add_transition(q0, q1, "a", "x");
        doc.add_transition(q0, q2, "a", "y");
        assert!(!doc.is_deterministic());
        assert_eq!(run_mealy(&doc, &["a"]), MealyOutcome::Ambiguous { at: 0 });
    }
}
