//! Setting a PDA's initial stack symbol through the commands the app calls.

use app_lib::commands::pda;
use app_lib::pda_ipc::PdaEditOpDto;
use app_lib::state::{PdaSession, SEEDED_TAB_ID};

fn set_symbol(session: &PdaSession, symbol: &str) {
    pda::apply(session, SEEDED_TAB_ID, vec![PdaEditOpDto::SetInitialStackSymbol { symbol: symbol.into() }]).unwrap();
}

#[test]
fn setting_the_symbol_updates_the_machine_and_gamma_even_when_no_transition_uses_it() {
    let session = PdaSession::new();

    set_symbol(&session, "A");

    let snapshot = pda::snapshot(&session, SEEDED_TAB_ID).unwrap();
    assert_eq!(snapshot.derived.initial_stack_symbol, "A");
    assert_eq!(snapshot.derived.stack_alphabet, vec!["A".to_string()]);
}

#[test]
fn the_steps_show_the_chosen_symbol_even_when_no_transition_uses_it() {
    let session = PdaSession::new();
    let added = pda::apply(&session, SEEDED_TAB_ID, vec![PdaEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]).unwrap();
    assert_eq!(added.revision, 1);
    let q0 = pda::snapshot(&session, SEEDED_TAB_ID).unwrap().states[0].id;
    pda::apply(&session, SEEDED_TAB_ID, vec![PdaEditOpDto::SetInitial { id: Some(q0) }]).unwrap();
    set_symbol(&session, "Z0");

    let trace = pda::sim(&session, SEEDED_TAB_ID, vec![], None, None).unwrap();

    assert_eq!(trace.steps[0][0].stack, vec!["Z0".to_string()]);
}

#[test]
fn leaving_the_symbol_blank_restores_z() {
    let session = PdaSession::new();
    set_symbol(&session, "A");

    set_symbol(&session, "  ");

    let snapshot = pda::snapshot(&session, SEEDED_TAB_ID).unwrap();
    assert_eq!(snapshot.derived.initial_stack_symbol, "Z");
    assert_eq!(snapshot.derived.stack_alphabet, vec!["Z".to_string()]);
}
