//! The step table returned by the simulation command the app calls.

use app_lib::commands::pda;
use app_lib::pda_ipc::PdaEditOpDto;
use app_lib::state::{PdaSession, SEEDED_TAB_ID};

/// `q0` and `q1`, with `q0` initial and `q1` accepting.
fn session_with_two_states() -> (PdaSession, u32, u32) {
    let session = PdaSession::new();
    pda::apply(
        &session,
        SEEDED_TAB_ID,
        vec![
            PdaEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            PdaEditOpDto::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ],
    )
    .unwrap();
    let states = pda::snapshot(&session, SEEDED_TAB_ID).unwrap().states;
    let id_of = |label: &str| states.iter().find(|s| s.label == label).unwrap().id;
    let (q0, q1) = (id_of("q0"), id_of("q1"));
    pda::apply(
        &session,
        SEEDED_TAB_ID,
        vec![PdaEditOpDto::SetInitial { id: Some(q0) }, PdaEditOpDto::SetAccepting { id: q1, accepting: true }],
    )
    .unwrap();
    (session, q0, q1)
}

#[test]
fn the_simulation_returns_the_step_table_with_names_next_to_the_trace() {
    let (session, q0, q1) = session_with_two_states();
    pda::apply(
        &session,
        SEEDED_TAB_ID,
        vec![PdaEditOpDto::AddTransition {
            from: q0,
            to: q1,
            input: Some("a".into()),
            pop: vec!["Z".into()],
            push: vec!["A".into(), "Z".into()],
        }],
    )
    .unwrap();

    let result = pda::sim(&session, SEEDED_TAB_ID, vec!["a".into()], None, None).unwrap();

    assert_eq!(result.outcome, "Accepted");
    assert_eq!(result.steps.len(), 2);
    assert_eq!(result.table.len(), 1);
    let row = &result.table[0];
    assert_eq!(row.state, "q0");
    assert_eq!(row.remaining, vec!["a".to_string()]);
    assert_eq!(row.stack, vec!["Z".to_string()]);
    assert_eq!(row.next_state.as_deref(), Some("q1"));
    assert_eq!(row.next_stack, vec!["A".to_string(), "Z".to_string()]);
}

#[test]
fn a_blocked_row_has_no_next_state_and_keeps_the_stack() {
    let (session, _, _) = session_with_two_states();

    let result = pda::sim(&session, SEEDED_TAB_ID, vec!["a".into()], None, None).unwrap();

    assert_eq!(result.table.len(), 1);
    assert_eq!(result.table[0].next_state, None);
    assert_eq!(result.table[0].next_stack, vec!["Z".to_string()]);
}
