//! Moore machine simulation — same "not built on the `Machine` trait"
//! reasoning as `engine::mealy`: a Moore machine is required to be
//! deterministic to mean anything as a synchronous transducer, so this
//! steps through exactly one live state at a time and *reports*
//! nondeterminism as a stuck outcome instead of branching to explore it.
//!
//! The one real difference from Mealy's engine: output comes from
//! **states**, not transitions (see `model::moore`'s doc comment, verified
//! against real JFLAP's `MooreStepByStateSimulator`). Concretely, that
//! means the initial state's output is emitted *before* consuming any
//! input — so `run_moore` on an `n`-symbol input produces `n + 1` output
//! symbols, not `n` like `run_mealy` does.

use crate::ids::StateId;
use crate::model::moore::MooreDoc;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MooreOutcome {
    /// One output symbol for the initial state, then one more per input
    /// symbol consumed — length `input.len() + 1`. A state with no output
    /// set contributes `""` (matches JFLAP's own unset-output default).
    Completed(Vec<String>),
    /// `doc` has no initial state.
    NoInitialState,
    /// Stuck at 0-indexed input position `at`: no transition matches (either
    /// the symbol was never used as an input anywhere, or this specific
    /// state just doesn't have one for it).
    NoTransition { at: usize },
    /// Stuck at 0-indexed input position `at`: more than one transition
    /// matches (`doc` is nondeterministic at this state/symbol — see
    /// `MooreDoc::is_deterministic`) — reading further would be ambiguous,
    /// so simulation stops rather than silently picking a branch.
    Ambiguous { at: usize },
}

fn output_of(doc: &MooreDoc, state: StateId) -> String {
    doc.output(state).and_then(|id| doc.output_symbol_label(id)).unwrap_or("").to_string()
}

/// Run `doc` on `input` (symbol labels, resolved against `doc`'s own input
/// alphabet — an unrecognized label is indistinguishable from "no
/// transition for this symbol here", since neither can ever match).
pub fn run_moore(doc: &MooreDoc, input: &[&str]) -> MooreOutcome {
    let Some(mut state) = doc.initial_state() else {
        return MooreOutcome::NoInitialState;
    };
    let mut outputs = Vec::with_capacity(input.len() + 1);
    outputs.push(output_of(doc, state));
    for (i, &symbol_label) in input.iter().enumerate() {
        let Some(symbol) = doc.input_symbol_label_to_id(symbol_label) else {
            return MooreOutcome::NoTransition { at: i };
        };
        let matches: Vec<StateId> = doc
            .edges()
            .filter(|((from, _), _)| *from == state)
            .filter_map(|((_, to), inputs)| inputs.contains(&symbol).then_some(*to))
            .collect();
        match matches.as_slice() {
            [] => return MooreOutcome::NoTransition { at: i },
            [next] => {
                state = *next;
                outputs.push(output_of(doc, state));
            }
            _ => return MooreOutcome::Ambiguous { at: i },
        }
    }
    MooreOutcome::Completed(outputs)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Parity-of-'a' Moore machine, output on state (not transition):
    /// q0 (output "even") -a-> q1 (output "odd") -a-> q0; both self-loop on
    /// "b" without changing parity.
    fn parity_machine() -> MooreDoc {
        let mut doc = MooreDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        doc.set_initial(Some(q0));
        let even = doc.intern_output_symbol("even");
        let odd = doc.intern_output_symbol("odd");
        doc.set_output(q0, Some(even));
        doc.set_output(q1, Some(odd));
        doc.add_transition(q0, q1, "a");
        doc.add_transition(q0, q0, "b");
        doc.add_transition(q1, q0, "a");
        doc.add_transition(q1, q1, "b");
        doc
    }

    #[test]
    fn empty_input_produces_exactly_the_initial_states_output() {
        assert_eq!(run_moore(&parity_machine(), &[]), MooreOutcome::Completed(vec!["even".into()]));
    }

    #[test]
    fn output_sequence_has_one_more_entry_than_the_input_length() {
        // hand-computed: q0(even) -a-> q1(odd) -b-> q1(odd) -a-> q0(even) -a-> q1(odd)
        let outcome = run_moore(&parity_machine(), &["a", "b", "a", "a"]);
        assert_eq!(
            outcome,
            MooreOutcome::Completed(vec!["even".into(), "odd".into(), "odd".into(), "even".into(), "odd".into()])
        );
    }

    #[test]
    fn all_self_loops_still_re_emit_the_same_output_each_step() {
        // hand-computed: q0(even) -b-> q0(even) -b-> q0(even) -b-> q0(even)
        let outcome = run_moore(&parity_machine(), &["b", "b", "b"]);
        assert_eq!(outcome, MooreOutcome::Completed(vec!["even".into(); 4]));
    }

    #[test]
    fn a_state_with_no_output_set_contributes_an_empty_string() {
        let mut doc = MooreDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        doc.set_initial(Some(q0));
        assert_eq!(run_moore(&doc, &[]), MooreOutcome::Completed(vec!["".into()]));
    }

    #[test]
    fn no_initial_state_is_reported_directly_not_as_a_stuck_position() {
        let mut doc = MooreDoc::new();
        doc.add_state("q0", 0.0, 0.0).unwrap();
        assert_eq!(run_moore(&doc, &["a"]), MooreOutcome::NoInitialState);
    }

    #[test]
    fn an_unrecognized_symbol_is_a_no_transition_stuck_outcome_at_its_position() {
        let outcome = run_moore(&parity_machine(), &["a", "z"]);
        assert_eq!(outcome, MooreOutcome::NoTransition { at: 1 });
    }

    #[test]
    fn a_state_missing_a_transition_for_an_otherwise_valid_symbol_is_stuck_there() {
        let mut doc = MooreDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        doc.set_initial(Some(q0));
        doc.add_transition(q0, q1, "a"); // only defines "a" as a symbol anywhere
        assert_eq!(run_moore(&doc, &["a", "a"]), MooreOutcome::NoTransition { at: 1 });
    }

    #[test]
    fn a_nondeterministic_machine_reports_ambiguous_instead_of_picking_a_branch() {
        let mut doc = MooreDoc::new();
        let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
        let q1 = doc.add_state("q1", 10.0, 0.0).unwrap();
        let q2 = doc.add_state("q2", 10.0, 10.0).unwrap();
        doc.set_initial(Some(q0));
        doc.add_transition(q0, q1, "a");
        doc.add_transition(q0, q2, "a");
        assert!(!doc.is_deterministic());
        assert_eq!(run_moore(&doc, &["a"]), MooreOutcome::Ambiguous { at: 0 });
    }
}
