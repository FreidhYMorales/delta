//! The step tables of the course workbook "Hoja de trabajo 10". Every expected
//! row is copied from the workbook, written the way it shows them:
//! `(state, remaining input, stack, next state, new stack)`. `A/B/Z` entries are
//! written out as one transition per stack symbol.

use std::collections::HashMap;

use automata_core::engine::pda::{pda_step_table, AcceptMode, PdaStepTable};
use automata_core::engine::Budget;
use automata_core::model::pda::PdaDoc;

/// `(from, input, pop, to, push)`; an empty input or push means ε.
type Rule = (&'static str, &'static str, &'static str, &'static str, &'static str);
type Row = (String, String, String, String, String);

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

fn table(doc: &PdaDoc, word: &str, mode: AcceptMode) -> PdaStepTable {
    let symbols: Vec<String> = word.chars().map(|c| c.to_string()).collect();
    let symbols: Vec<&str> = symbols.iter().map(String::as_str).collect();
    pda_step_table(doc, &symbols, mode, Budget::default())
}

fn text(symbols: &[String]) -> String {
    if symbols.is_empty() {
        "ε".to_string()
    } else {
        symbols.concat()
    }
}

fn rows(table: &PdaStepTable) -> Vec<Row> {
    table
        .rows
        .iter()
        .map(|row| {
            let (next_state, next_stack) = match &row.next {
                Some((state, stack)) => (state.clone(), text(stack)),
                None => ("BLOQUEO".to_string(), text(&row.stack)),
            };
            (row.state.clone(), text(&row.remaining), text(&row.stack), next_state, next_stack)
        })
        .collect()
}

fn expected(rows: &[(&str, &str, &str, &str, &str)]) -> Vec<Row> {
    rows.iter()
        .map(|(a, b, c, d, e)| (a.to_string(), b.to_string(), c.to_string(), d.to_string(), e.to_string()))
        .collect()
}

fn exercise_2_2() -> PdaDoc {
    machine(
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
    )
}

fn exercise_1_2() -> PdaDoc {
    machine(
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
    )
}

#[test]
fn exercise_1_2_aaabbab_ends_blocked_and_is_not_accepted() {
    let result = table(&exercise_1_2(), "aaabbab", AcceptMode::FinalState);

    assert!(!result.accepted);
    assert_eq!(
        rows(&result),
        expected(&[
            ("p", "aaabbab", "Z", "q1", "AZ"),
            ("q1", "aaabbab", "AZ", "q2", "BAZ"),
            ("q2", "aabbab", "BAZ", "q2", "BBAZ"),
            ("q2", "abbab", "BBAZ", "q2", "BBBAZ"),
            ("q2", "bbab", "BBBAZ", "q3", "BBAZ"),
            ("q3", "bab", "BBAZ", "q3", "BAZ"),
            ("q3", "ab", "BAZ", "BLOQUEO", "BAZ"),
        ]),
    );
}

#[test]
fn exercise_1_2_aabbb_ends_on_an_empty_stack_without_a_blocked_row() {
    let result = table(&exercise_1_2(), "aabbb", AcceptMode::FinalState);

    assert!(!result.accepted);
    assert_eq!(
        rows(&result),
        expected(&[
            ("p", "aabbb", "Z", "q1", "AZ"),
            ("q1", "aabbb", "AZ", "q2", "BAZ"),
            ("q2", "abbb", "BAZ", "q2", "BBAZ"),
            ("q2", "bbb", "BBAZ", "q3", "BAZ"),
            ("q3", "bb", "BAZ", "q3", "AZ"),
            ("q3", "b", "AZ", "q4", "AZ"),
            ("q4", "b", "AZ", "r", "Z"),
            ("r", "b", "Z", "r", "ε"),
        ]),
    );
}

#[test]
fn exercise_2_2_abb_shows_the_workbook_rows_and_is_accepted() {
    let result = table(&exercise_2_2(), "abb", AcceptMode::FinalState);

    assert!(result.accepted);
    assert_eq!(
        rows(&result),
        expected(&[
            ("q0", "abb", "Z0", "q1", "AAZ0"),
            ("q1", "bb", "AAZ0", "q1", "AZ0"),
            ("q1", "b", "AZ0", "q1", "Z0"),
            ("q1", "ε", "Z0", "q0", "Z0"),
            ("q0", "ε", "Z0", "f", "ε"),
        ]),
    );
}
