//! PR8 of the `multi-tab-projects` change: TM's 7 commands (`commands::tm`)
//! now take a resolved `TabId` (design D3), looked up via `TmSession`'s
//! fallible `try_with`/`try_with_mut` helpers instead of the hardcoded
//! `SEEDED_TAB_ID`. Same shape as `tests/pda_tab_isolation.rs` — this file
//! proves the two new properties that migration adds:
//!
//! 1. Editing one tab never leaks into another tab's document.
//! 2. An unknown/forged `TabId` is a clean `Err`, never a panic.

use app_lib::commands::tm;
use app_lib::tm_ipc::TmEditOpDto;
use app_lib::state::TmSession;
use app_lib::tabs::TabId;
use automata_core::tm_doc::TmDocument;

/// A `TabId` never allocated in any of these tests' sessions.
const UNKNOWN_TAB: TabId = TabId(999);

#[test]
fn tm_apply_on_one_tab_does_not_affect_a_second_tabs_document() {
    let session = TmSession::new();
    let tab_a = TabId(0); // the seeded tab
    let tab_b = TabId(1);
    session.insert(tab_b, TmDocument::new());

    tm::apply(&session, tab_a, vec![TmEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }])
        .expect("apply on tab A must succeed");

    let snap_a = tm::snapshot(&session, tab_a).unwrap();
    let snap_b = tm::snapshot(&session, tab_b).unwrap();
    assert_eq!(snap_a.states.len(), 1, "tab A must have received the edit");
    assert_eq!(snap_b.states.len(), 0, "tab B must be completely unaffected");
}

#[test]
fn tm_sim_on_one_tab_only_sees_that_tabs_document() {
    let session = TmSession::new();
    let tab_a = TabId(0);
    let tab_b = TabId(1);
    session.insert(tab_b, TmDocument::new());

    let r = tm::apply(&session, tab_a, vec![TmEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]).unwrap();
    let q0 = match &r.patches[0] {
        app_lib::tm_ipc::TmDocPatch::StateAdded { id, .. } => *id,
        _ => panic!("expected StateAdded"),
    };
    let r2 = tm::apply(&session, tab_a, vec![TmEditOpDto::AddState { label: "q1".into(), x: 10.0, y: 0.0 }]).unwrap();
    let q1 = match &r2.patches[0] {
        app_lib::tm_ipc::TmDocPatch::StateAdded { id, .. } => *id,
        _ => panic!("expected StateAdded"),
    };
    tm::apply(
        &session,
        tab_a,
        vec![
            TmEditOpDto::SetInitial { id: Some(q0) },
            TmEditOpDto::SetAccepting { id: q1, accepting: true },
            TmEditOpDto::AddTransition {
                from: q0,
                to: q1,
                tapes: vec![automata_core::dto::TmTapeOpDto { read: "a".into(), write: "a".into(), direction: "R".into() }],
            },
        ],
    )
    .unwrap();

    let outcome_a = tm::sim(&session, tab_a, vec![vec!["a".to_string()]], None, None).unwrap();
    assert_eq!(outcome_a.outcome, "Accepted");

    // Tab B is still the fresh empty document: no initial state at all, so
    // simulation is stuck immediately, never even seeing tab A's states or
    // transitions — proves tab A's edits never reached tab B.
    let outcome_b = tm::sim(&session, tab_b, vec![vec!["a".to_string()]], None, None).unwrap();
    assert_eq!(outcome_b.outcome, "Stuck", "tab B must remain the untouched empty document");
}

#[test]
fn tm_snapshot_on_an_unknown_tab_id_is_an_err_not_a_panic() {
    let session = TmSession::new();
    assert!(tm::snapshot(&session, UNKNOWN_TAB).is_err());
}

#[test]
fn tm_apply_on_an_unknown_tab_id_is_an_err_not_a_panic() {
    let session = TmSession::new();
    let result = tm::apply(&session, UNKNOWN_TAB, vec![TmEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]);
    assert!(result.is_err());
}

#[test]
fn tm_undo_and_redo_on_an_unknown_tab_id_are_err_not_a_panic() {
    let session = TmSession::new();
    assert!(tm::undo(&session, UNKNOWN_TAB).is_err());
    assert!(tm::redo(&session, UNKNOWN_TAB).is_err());
}

#[test]
fn tm_sim_on_an_unknown_tab_id_is_an_err_not_a_panic() {
    let session = TmSession::new();
    assert!(tm::sim(&session, UNKNOWN_TAB, vec![], None, None).is_err());
}

#[test]
fn tm_save_on_an_unknown_tab_id_is_an_err_not_a_panic() {
    let session = TmSession::new();
    let dir = std::env::temp_dir();
    let path = dir.join(format!("jflap-unknown-tab-tm-save-{}.json", std::process::id()));
    let result = tm::save(&session, UNKNOWN_TAB, path.to_string_lossy().to_string());
    assert!(result.is_err());
}

#[test]
fn tm_open_on_an_unknown_tab_id_is_an_err_not_a_panic() {
    let session = TmSession::new();
    // Seed a valid document on the seeded tab, save it, then attempt to open
    // it into an unknown tab id: the read/parse succeeds, only the session
    // lookup must fail.
    let path = std::env::temp_dir().join(format!("jflap-unknown-tab-tm-open-{}.json", std::process::id()));
    tm::save(&session, app_lib::state::SEEDED_TAB_ID, path.to_string_lossy().to_string()).unwrap();

    let result = tm::open(&session, UNKNOWN_TAB, path.to_string_lossy().to_string());
    std::fs::remove_file(&path).ok();
    assert!(result.is_err());
}
