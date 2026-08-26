//! PR6 of the `multi-tab-projects` change: Moore's 7 commands
//! (`commands::moore`) now take a resolved `TabId` (design D3), looked up via
//! `MooreSession`'s fallible `try_with`/`try_with_mut` helpers instead of the
//! hardcoded `SEEDED_TAB_ID`. Same shape as `tests/mealy_tab_isolation.rs` —
//! this file proves the two new properties that migration adds:
//!
//! 1. Editing one tab never leaks into another tab's document.
//! 2. An unknown/forged `TabId` is a clean `Err`, never a panic.

use app_lib::commands::moore;
use app_lib::moore_ipc::MooreEditOpDto;
use app_lib::state::MooreSession;
use app_lib::tabs::TabId;
use automata_core::moore_doc::MooreDocument;

/// A `TabId` never allocated in any of these tests' sessions.
const UNKNOWN_TAB: TabId = TabId(999);

#[test]
fn moore_apply_on_one_tab_does_not_affect_a_second_tabs_document() {
    let session = MooreSession::new();
    let tab_a = TabId(0); // the seeded tab
    let tab_b = TabId(1);
    session.insert(tab_b, MooreDocument::new());

    moore::apply(&session, tab_a, vec![MooreEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }])
        .expect("apply on tab A must succeed");

    let snap_a = moore::snapshot(&session, tab_a).unwrap();
    let snap_b = moore::snapshot(&session, tab_b).unwrap();
    assert_eq!(snap_a.states.len(), 1, "tab A must have received the edit");
    assert_eq!(snap_b.states.len(), 0, "tab B must be completely unaffected");
}

#[test]
fn moore_sim_on_one_tab_only_sees_that_tabs_document() {
    let session = MooreSession::new();
    let tab_a = TabId(0);
    let tab_b = TabId(1);
    session.insert(tab_b, MooreDocument::new());

    let r = moore::apply(&session, tab_a, vec![MooreEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]).unwrap();
    let q0 = match &r.patches[0] {
        app_lib::moore_ipc::MooreDocPatch::StateAdded { id, .. } => *id,
        _ => panic!("expected StateAdded"),
    };
    let r2 = moore::apply(&session, tab_a, vec![MooreEditOpDto::AddState { label: "q1".into(), x: 10.0, y: 0.0 }]).unwrap();
    let q1 = match &r2.patches[0] {
        app_lib::moore_ipc::MooreDocPatch::StateAdded { id, .. } => *id,
        _ => panic!("expected StateAdded"),
    };
    moore::apply(
        &session,
        tab_a,
        vec![
            MooreEditOpDto::SetInitial { id: Some(q0) },
            MooreEditOpDto::SetOutput { state: q0, output: Some("even".into()) },
            MooreEditOpDto::SetOutput { state: q1, output: Some("odd".into()) },
            MooreEditOpDto::SetTransitions { from: q0, to: q1, inputs: vec!["a".into()] },
        ],
    )
    .unwrap();

    let outcome_a = moore::sim(&session, tab_a, vec!["a".to_string()]).unwrap();
    assert_eq!(outcome_a, moore::MooreSimDto::Completed { outputs: vec!["even".to_string(), "odd".to_string()] });

    // Tab B is still the fresh empty document: no initial state at all, so
    // simulation reports `NoInitialState` — proves tab A's edits never
    // reached tab B.
    let outcome_b = moore::sim(&session, tab_b, vec!["a".to_string()]).unwrap();
    assert_eq!(outcome_b, moore::MooreSimDto::NoInitialState, "tab B must remain the untouched empty document");
}

#[test]
fn moore_snapshot_on_an_unknown_tab_id_is_an_err_not_a_panic() {
    let session = MooreSession::new();
    assert!(moore::snapshot(&session, UNKNOWN_TAB).is_err());
}

#[test]
fn moore_apply_on_an_unknown_tab_id_is_an_err_not_a_panic() {
    let session = MooreSession::new();
    let result = moore::apply(&session, UNKNOWN_TAB, vec![MooreEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]);
    assert!(result.is_err());
}

#[test]
fn moore_undo_and_redo_on_an_unknown_tab_id_are_err_not_a_panic() {
    let session = MooreSession::new();
    assert!(moore::undo(&session, UNKNOWN_TAB).is_err());
    assert!(moore::redo(&session, UNKNOWN_TAB).is_err());
}

#[test]
fn moore_sim_on_an_unknown_tab_id_is_an_err_not_a_panic() {
    let session = MooreSession::new();
    assert!(moore::sim(&session, UNKNOWN_TAB, vec![]).is_err());
}

#[test]
fn moore_save_on_an_unknown_tab_id_is_an_err_not_a_panic() {
    let session = MooreSession::new();
    let dir = std::env::temp_dir();
    let path = dir.join(format!("jflap-unknown-tab-moore-save-{}.json", std::process::id()));
    let result = moore::save(&session, UNKNOWN_TAB, path.to_string_lossy().to_string());
    assert!(result.is_err());
}

#[test]
fn moore_open_on_an_unknown_tab_id_is_an_err_not_a_panic() {
    let session = MooreSession::new();
    // Seed a valid document on the seeded tab, save it, then attempt to open
    // it into an unknown tab id: the read/parse succeeds, only the session
    // lookup must fail.
    let path = std::env::temp_dir().join(format!("jflap-unknown-tab-moore-open-{}.json", std::process::id()));
    moore::save(&session, app_lib::state::SEEDED_TAB_ID, path.to_string_lossy().to_string()).unwrap();

    let result = moore::open(&session, UNKNOWN_TAB, path.to_string_lossy().to_string());
    std::fs::remove_file(&path).ok();
    assert!(result.is_err());
}
