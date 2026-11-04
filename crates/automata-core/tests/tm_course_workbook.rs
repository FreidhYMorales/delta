//! The three Turing machines and nine words of the course workbook
//! "maquinas_turing", with the final state and tape the workbook gives.
//! `a|b|c` entries are written out as one transition per symbol, and the
//! workbook's `B` is the engine's blank.

use std::collections::HashMap;

use automata_core::engine::tm::{run_tm, AcceptMode};
use automata_core::engine::{Budget, Outcome};
use automata_core::ids::StateId;
use automata_core::model::tm::{Direction, TmDoc, TmTapeOp, BLANK};

/// `(from, read, write, direction, to)`.
type Rule = (&'static str, &'static str, &'static str, char, &'static str);

struct Machine {
    doc: TmDoc,
    names: HashMap<StateId, String>,
}

fn machine(states: &[&str], initial: &str, accepting: &str, rules: &[Rule]) -> Machine {
    let mut doc = TmDoc::new();
    let ids: HashMap<&str, StateId> = states
        .iter()
        .enumerate()
        .map(|(i, name)| (*name, doc.add_state(name, i as f64, 0.0).unwrap()))
        .collect();
    doc.set_initial(Some(ids[initial]));
    doc.set_accepting(ids[accepting], true);
    let label = |symbol: &'static str| if symbol == "B" { BLANK } else { symbol };
    for (from, read, write, direction, to) in rules {
        let read = doc.intern_symbol(label(read));
        let write = doc.intern_symbol(label(write));
        let direction = match direction {
            'L' => Direction::Left,
            'R' => Direction::Right,
            _ => Direction::Stay,
        };
        doc.add_transition(ids[from], ids[to], vec![TmTapeOp { read, write, direction }]).unwrap();
    }
    let names = ids.iter().map(|(name, id)| (*id, name.to_string())).collect();
    Machine { doc, names }
}

/// Runs `word` by final state and returns its outcome, final state, tape and
/// head position, counted from the word's first symbol.
fn run(machine: &Machine, word: &str) -> (Outcome, String, String, i64) {
    let symbols: Vec<String> = word.chars().map(|c| c.to_string()).collect();
    let symbols: Vec<&str> = symbols.iter().map(String::as_str).collect();
    let trace = run_tm(&machine.doc, &[&symbols], AcceptMode::FinalState, Budget::default());
    let (state, tapes) = &trace.steps.last().unwrap().configs[0];
    let tape = tapes[0].cells.values().map(|s| machine.doc.symbol_label(*s).unwrap()).collect();
    (trace.outcome, machine.names[state].clone(), tape, tapes[0].head)
}

fn accepted(state: &str, tape: &str, head: i64) -> (Outcome, String, String, i64) {
    (Outcome::Accepted, state.to_string(), tape.to_string(), head)
}

#[test]
fn mt1_inverts_every_bit() {
    let mt1 = machine(
        &["q0", "q1"],
        "q0",
        "q1",
        &[("q0", "1", "0", 'R', "q0"), ("q0", "0", "1", 'R', "q0"), ("q0", "B", "B", 'S', "q1")],
    );

    assert_eq!(run(&mt1, "010"), accepted("q1", "101", 3));
    assert_eq!(run(&mt1, "111"), accepted("q1", "000", 3));
    assert_eq!(run(&mt1, "00011"), accepted("q1", "11100", 5));
}

#[test]
fn mt2_inverts_every_bit_and_returns_to_the_first_symbol() {
    let mt2 = machine(
        &["q0", "q1", "q2"],
        "q0",
        "q2",
        &[
            ("q0", "1", "0", 'R', "q0"),
            ("q0", "0", "1", 'R', "q0"),
            ("q0", "B", "B", 'L', "q1"),
            ("q1", "0", "0", 'L', "q1"),
            ("q1", "1", "1", 'L', "q1"),
            ("q1", "B", "B", 'R', "q2"),
        ],
    );

    assert_eq!(run(&mt2, "01010101"), accepted("q2", "10101010", 0));
    assert_eq!(run(&mt2, "10101010"), accepted("q2", "01010101", 0));
    assert_eq!(run(&mt2, "0011001100"), accepted("q2", "1100110011", 0));
}

#[test]
fn mt3_marks_each_letter_and_appends_a_one() {
    let mt3 = machine(
        &["q0", "q1", "q2", "qf"],
        "q0",
        "qf",
        &[
            ("q0", "a", "X", 'R', "q1"),
            ("q0", "b", "X", 'R', "q1"),
            ("q0", "c", "X", 'R', "q1"),
            ("q1", "a", "a", 'R', "q1"),
            ("q1", "b", "b", 'R', "q1"),
            ("q1", "c", "c", 'R', "q1"),
            ("q1", "1", "1", 'R', "q1"),
            ("q1", "B", "1", 'L', "q2"),
            ("q2", "a", "a", 'L', "q2"),
            ("q2", "b", "b", 'L', "q2"),
            ("q2", "c", "c", 'L', "q2"),
            ("q2", "1", "1", 'L', "q2"),
            ("q2", "X", "X", 'R', "q0"),
            ("q0", "1", "1", 'S', "qf"),
        ],
    );

    assert_eq!(run(&mt3, "abc"), accepted("qf", "XXX111", 3));
    assert_eq!(run(&mt3, "abca"), accepted("qf", "XXXX1111", 4));
    assert_eq!(run(&mt3, "bacb"), accepted("qf", "XXXX1111", 4));
}
