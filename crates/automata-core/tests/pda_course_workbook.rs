//! The four PDAs and eight words of the course workbook "Hoja de trabajo 10",
//! with the verdicts the workbook gives. `A/B/Z` entries are written out as one
//! transition per stack symbol, and stack strings are separated by spaces.

use std::collections::HashMap;

use automata_core::engine::pda::{run_pda, AcceptMode};
use automata_core::engine::{Budget, Outcome};
use automata_core::model::pda::PdaDoc;

/// `(from, input, pop, to, push)`; an empty input or push means ε.
type Rule = (&'static str, &'static str, &'static str, &'static str, &'static str);

fn machine(states: &[&str], initial: &str, accepting: &str, initial_stack: &str, rules: &[Rule]) -> PdaDoc {
    let mut doc = PdaDoc::new();
    let ids: HashMap<&str, _> = states
        .iter()
        .enumerate()
        .map(|(i, name)| (*name, doc.add_state(name, i as f64, 0.0).unwrap()))
        .collect();
    doc.set_initial(Some(ids[initial]));
    doc.set_accepting(ids[accepting], true);
    doc.set_initial_stack_symbol(initial_stack);
    for (from, input, pop, to, push) in rules {
        let input = (!input.is_empty()).then(|| doc.intern_input_symbol(input));
        let pop = vec![doc.intern_stack_symbol(pop)];
        let push = push.split_whitespace().map(|s| doc.intern_stack_symbol(s)).collect();
        doc.add_transition(ids[from], ids[to], input, pop, push);
    }
    doc
}

fn outcome(doc: &PdaDoc, word: &str, mode: AcceptMode) -> Outcome {
    let symbols: Vec<String> = word.chars().map(|c| c.to_string()).collect();
    let symbols: Vec<&str> = symbols.iter().map(String::as_str).collect();
    run_pda(doc, &symbols, mode, Budget::default()).outcome
}

fn accepted_by_final_state(doc: &PdaDoc, word: &str) -> bool {
    outcome(doc, word, AcceptMode::FinalState) == Outcome::Accepted
}

#[test]
fn exercise_1_1_accepts_both_words_by_final_state_and_by_empty_stack() {
    let doc = machine(
        &["mn", "m", "t", "n"],
        "mn",
        "n",
        "Z",
        &[
            ("mn", "a", "Z", "mn", "N Z"),
            ("mn", "a", "M", "mn", "M M"),
            ("mn", "a", "N", "mn", "M N"),
            ("mn", "a", "N", "mn", "N N"),
            ("mn", "b", "N", "m", "B N"),
            ("mn", "b", "M", "m", ""),
            ("m", "b", "B", "m", "B B"),
            ("m", "b", "N", "m", "B N"),
            ("m", "b", "M", "m", ""),
            ("m", "a", "B", "t", ""),
            ("t", "a", "B", "t", ""),
            ("t", "b", "N", "n", ""),
            ("n", "b", "N", "n", ""),
            ("n", "", "Z", "n", ""),
        ],
    );

    assert!(accepted_by_final_state(&doc, "aababb"));
    assert!(accepted_by_final_state(&doc, "aaabbabb"));
    assert_eq!(outcome(&doc, "aababb", AcceptMode::EmptyStack), Outcome::Accepted);
    assert_eq!(outcome(&doc, "aaabbabb", AcceptMode::EmptyStack), Outcome::Accepted);
}

#[test]
fn exercise_1_2_does_not_accept_either_word() {
    let doc = machine(
        &["p", "q1", "q2", "q3", "q4", "r"],
        "p",
        "r",
        "Z",
        &[
            ("p", "", "Z", "q1", "A Z"),
            ("q1", "a", "A", "q2", "B A"),
            ("q1", "a", "A", "q4", "A"),
            ("q1", "", "A", "q4", ""),
            ("q2", "a", "B", "q2", "B B"),
            ("q2", "b", "B", "q3", ""),
            ("q3", "b", "B", "q3", ""),
            ("q3", "", "A", "q4", "A"),
            ("q4", "", "A", "r", ""),
            ("q4", "", "B", "r", ""),
            ("q4", "", "Z", "r", ""),
            ("r", "", "A", "r", ""),
            ("r", "", "B", "r", ""),
            ("r", "", "Z", "r", ""),
        ],
    );

    assert!(!accepted_by_final_state(&doc, "aabbb"));
    assert!(!accepted_by_final_state(&doc, "aaabbab"));
}

#[test]
fn exercise_2_1_with_initial_symbol_a_accepts_both_words() {
    let doc = machine(
        &["q1", "q2", "q3", "q4"],
        "q1",
        "q4",
        "A",
        &[
            ("q1", "a", "A", "q2", "B A"),
            ("q1", "a", "A", "q4", "A"),
            ("q1", "", "A", "q4", ""),
            ("q2", "a", "B", "q2", "B B"),
            ("q2", "b", "B", "q3", ""),
            ("q3", "", "A", "q4", "A"),
            ("q3", "b", "B", "q3", ""),
        ],
    );

    assert!(accepted_by_final_state(&doc, ""));
    assert!(accepted_by_final_state(&doc, "ab"));
}

#[test]
fn exercise_2_2_with_initial_symbol_z0_accepts_both_words() {
    let doc = machine(
        &["q0", "q1", "q2", "q3", "f"],
        "q0",
        "f",
        "Z0",
        &[
            ("q0", "a", "Z0", "q1", "A A Z0"),
            ("q0", "b", "Z0", "q2", "B Z0"),
            ("q0", "", "Z0", "f", ""),
            ("q1", "a", "A", "q1", "A A A"),
            ("q1", "b", "A", "q1", ""),
            ("q1", "", "Z0", "q0", "Z0"),
            ("q2", "a", "B", "q3", ""),
            ("q2", "b", "B", "q2", "B B"),
            ("q2", "", "Z0", "q0", "Z0"),
            ("q3", "", "B", "q2", ""),
            ("q3", "", "Z0", "q1", "A Z0"),
        ],
    );

    assert!(accepted_by_final_state(&doc, ""));
    assert!(accepted_by_final_state(&doc, "abb"));
}
