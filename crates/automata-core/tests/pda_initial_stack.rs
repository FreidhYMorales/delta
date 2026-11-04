//! A PDA's initial stack symbol, checked against the course workbook.

use automata_core::dto::{pda_load_from_str, pda_save_to_string};
use automata_core::engine::pda::{run_pda, AcceptMode};
use automata_core::engine::{Budget, Outcome};
use automata_core::model::pda::PdaDoc;
use automata_core::pda_doc::{PdaDocument, PdaEditOp};

fn set_symbol(symbol: &str) -> PdaEditOp {
    PdaEditOp::SetInitialStackSymbol { symbol: symbol.to_string() }
}

#[test]
fn a_saved_file_keeps_the_symbol_when_reopened() {
    let mut doc = PdaDoc::new();
    doc.set_initial_stack_symbol("A");

    let saved = pda_save_to_string(&doc).unwrap();
    let reopened = pda_load_from_str(&saved).unwrap();

    assert_eq!(reopened.initial_stack_symbol(), "A");
}

/// The file shape saved before the initial stack symbol existed.
#[test]
fn a_file_without_the_symbol_opens_with_z_and_gives_the_same_verdict() {
    let old_file = r#"{
        "version": 1,
        "document": {
            "kind": "Pda",
            "states": [
                {"label": "q0", "x": 0.0, "y": 0.0, "accepting": false},
                {"label": "q1", "x": 1.0, "y": 0.0, "accepting": true}
            ],
            "transitions": [
                {"from": 0, "to": 1, "input": "a", "pop": ["Z"], "push": []}
            ],
            "initial": 0
        }
    }"#;

    let doc = pda_load_from_str(old_file).unwrap();

    assert_eq!(doc.initial_stack_symbol(), "Z");
    let trace = run_pda(&doc, &["a"], AcceptMode::FinalState, Budget::default());
    assert_eq!(trace.outcome, Outcome::Accepted);
}

#[test]
fn changing_the_symbol_can_be_undone_and_redone() {
    let mut document = PdaDocument::new();

    document.apply(vec![set_symbol("A")]);
    document.apply(vec![set_symbol("Z0")]);
    assert_eq!(document.model.initial_stack_symbol(), "Z0");

    assert!(document.undo());
    assert_eq!(document.model.initial_stack_symbol(), "A");
    assert!(document.undo());
    assert_eq!(document.model.initial_stack_symbol(), "Z");

    assert!(document.redo());
    assert_eq!(document.model.initial_stack_symbol(), "A");
}

/// Workbook exercise 2-2: its initial stack symbol is the two-character `Z0`.
#[test]
fn exercise_2_2_starts_from_z0_and_accepts_abb() {
    let mut doc = PdaDoc::new();
    let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
    let q1 = doc.add_state("q1", 1.0, 0.0).unwrap();
    let q2 = doc.add_state("q2", 2.0, 0.0).unwrap();
    let q3 = doc.add_state("q3", 3.0, 0.0).unwrap();
    let f = doc.add_state("f", 4.0, 0.0).unwrap();
    doc.set_initial(Some(q0));
    doc.set_accepting(f, true);
    doc.set_initial_stack_symbol("Z0");

    let a = doc.intern_input_symbol("a");
    let b = doc.intern_input_symbol("b");
    let z0 = doc.intern_stack_symbol("Z0");
    let sym_a = doc.intern_stack_symbol("A");
    let sym_b = doc.intern_stack_symbol("B");
    doc.add_transition(q0, q1, Some(a), vec![z0], vec![sym_a, sym_a, z0]);
    doc.add_transition(q0, q2, Some(b), vec![z0], vec![sym_b, z0]);
    doc.add_transition(q0, f, None, vec![z0], vec![]);
    doc.add_transition(q1, q1, Some(a), vec![sym_a], vec![sym_a, sym_a, sym_a]);
    doc.add_transition(q1, q1, Some(b), vec![sym_a], vec![]);
    doc.add_transition(q1, q0, None, vec![z0], vec![z0]);
    doc.add_transition(q2, q3, Some(a), vec![sym_b], vec![]);
    doc.add_transition(q2, q2, Some(b), vec![sym_b], vec![sym_b, sym_b]);
    doc.add_transition(q2, q0, None, vec![z0], vec![z0]);
    doc.add_transition(q3, q2, None, vec![sym_b], vec![]);
    doc.add_transition(q3, q1, None, vec![z0], vec![sym_a, z0]);

    let trace = run_pda(&doc, &["a", "b", "b"], AcceptMode::FinalState, Budget::default());

    assert_eq!(trace.outcome, Outcome::Accepted);
    assert_eq!(trace.steps[0].configs, vec![(q0, vec![z0])]);
    assert!(trace.steps.last().unwrap().configs.contains(&(f, vec![])));
}

#[test]
fn a_machine_that_never_sets_the_symbol_still_starts_from_z() {
    let mut doc = PdaDoc::new();
    let q0 = doc.add_state("q0", 0.0, 0.0).unwrap();
    let q1 = doc.add_state("q1", 1.0, 0.0).unwrap();
    doc.set_initial(Some(q0));
    doc.set_accepting(q1, true);
    let z = doc.intern_stack_symbol("Z");
    doc.add_transition(q0, q1, None, vec![z], vec![]);

    let trace = run_pda(&doc, &[], AcceptMode::FinalState, Budget::default());

    assert_eq!(doc.initial_stack_symbol(), "Z");
    assert_eq!(trace.outcome, Outcome::Accepted);
    assert_eq!(trace.steps[0].configs, vec![(q0, vec![z])]);
}
