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
fn leaving_the_symbol_blank_restores_z() {
    let session = PdaSession::new();
    set_symbol(&session, "A");

    set_symbol(&session, "  ");

    let snapshot = pda::snapshot(&session, SEEDED_TAB_ID).unwrap();
    assert_eq!(snapshot.derived.initial_stack_symbol, "Z");
    assert_eq!(snapshot.derived.stack_alphabet, vec!["Z".to_string()]);
}
