//! PR7 of the `multi-tab-projects` change: PDA's 7 commands
//! (`commands::pda`) now take a resolved `TabId` (design D3), looked up via
//! `PdaSession`'s fallible `try_with`/`try_with_mut` helpers instead of the
//! hardcoded `SEEDED_TAB_ID`. Same shape as `tests/moore_tab_isolation.rs` —
//! this file proves the two new properties that migration adds:
//!
//! 1. Editing one tab never leaks into another tab's document.
//! 2. An unknown/forged `TabId` is a clean `Err`, never a panic.

use app_lib::commands::pda;
use app_lib::pda_ipc::PdaEditOpDto;
use app_lib::state::PdaSession;
use app_lib::tabs::TabId;
use automata_core::pda_doc::PdaDocument;

/// A `TabId` never allocated in any of these tests' sessions.
const UNKNOWN_TAB: TabId = TabId(999);

#[test]
fn pda_apply_on_one_tab_does_not_affect_a_second_tabs_document() {
    let session = PdaSession::new();
    let tab_a = TabId(0); // the seeded tab
    let tab_b = TabId(1);
    session.insert(tab_b, PdaDocument::new());

    pda::apply(&session, tab_a, vec![PdaEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }])
        .expect("apply on tab A must succeed");

    let snap_a = pda::snapshot(&session, tab_a).unwrap();
    let snap_b = pda::snapshot(&session, tab_b).unwrap();
    assert_eq!(snap_a.states.len(), 1, "tab A must have received the edit");
    assert_eq!(snap_b.states.len(), 0, "tab B must be completely unaffected");
}

#[test]
fn pda_sim_on_one_tab_only_sees_that_tabs_document() {
    let session = PdaSession::new();
    let tab_a = TabId(0);
    let tab_b = TabId(1);
    session.insert(tab_b, PdaDocument::new());

    let r = pda::apply(&session, tab_a, vec![PdaEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]).unwrap();
    let q0 = match &r.patches[0] {
        app_lib::pda_ipc::PdaDocPatch::StateAdded { id, .. } => *id,
        _ => panic!("expected StateAdded"),
    };
    let r2 = pda::apply(&session, tab_a, vec![PdaEditOpDto::AddState { label: "q1".into(), x: 10.0, y: 0.0 }]).unwrap();
    let q1 = match &r2.patches[0] {
        app_lib::pda_ipc::PdaDocPatch::StateAdded { id, .. } => *id,
        _ => panic!("expected StateAdded"),
    };
    pda::apply(
        &session,
        tab_a,
        vec![
            PdaEditOpDto::SetInitial { id: Some(q0) },
            PdaEditOpDto::SetAccepting { id: q1, accepting: true },
            PdaEditOpDto::AddTransition { from: q0, to: q1, input: Some("a".into()), pop: vec![], push: vec![] },
        ],
    )
    .unwrap();

    let outcome_a = pda::sim(&session, tab_a, vec!["a".to_string()], None, None).unwrap();
    assert_eq!(outcome_a.outcome, "Accepted");

    // Tab B is still the fresh empty document: no initial state at all, so
    // simulation is stuck immediately, never even seeing tab A's states or
    // transitions — proves tab A's edits never reached tab B.
    let outcome_b = pda::sim(&session, tab_b, vec!["a".to_string()], None, None).unwrap();
    assert_eq!(outcome_b.outcome, "Stuck", "tab B must remain the untouched empty document");
}

#[test]
fn pda_snapshot_on_an_unknown_tab_id_is_an_err_not_a_panic() {
    let session = PdaSession::new();
    assert!(pda::snapshot(&session, UNKNOWN_TAB).is_err());
}

#[test]
fn pda_apply_on_an_unknown_tab_id_is_an_err_not_a_panic() {
    let session = PdaSession::new();
    let result = pda::apply(&session, UNKNOWN_TAB, vec![PdaEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]);
    assert!(result.is_err());
}

#[test]
fn pda_undo_and_redo_on_an_unknown_tab_id_are_err_not_a_panic() {
    let session = PdaSession::new();
    assert!(pda::undo(&session, UNKNOWN_TAB).is_err());
    assert!(pda::redo(&session, UNKNOWN_TAB).is_err());
}

#[test]
fn pda_sim_on_an_unknown_tab_id_is_an_err_not_a_panic() {
    let session = PdaSession::new();
    assert!(pda::sim(&session, UNKNOWN_TAB, vec![], None, None).is_err());
}

#[test]
fn pda_save_on_an_unknown_tab_id_is_an_err_not_a_panic() {
    let session = PdaSession::new();
    let dir = std::env::temp_dir();
    let path = dir.join(format!("jflap-unknown-tab-pda-save-{}.json", std::process::id()));
    let result = pda::save(&session, UNKNOWN_TAB, path.to_string_lossy().to_string());
    assert!(result.is_err());
}

#[test]
fn pda_open_on_an_unknown_tab_id_is_an_err_not_a_panic() {
    let session = PdaSession::new();
    // Seed a valid document on the seeded tab, save it, then attempt to open
    // it into an unknown tab id: the read/parse succeeds, only the session
    // lookup must fail.
    let path = std::env::temp_dir().join(format!("jflap-unknown-tab-pda-open-{}.json", std::process::id()));
    pda::save(&session, app_lib::state::SEEDED_TAB_ID, path.to_string_lossy().to_string()).unwrap();

    let result = pda::open(&session, UNKNOWN_TAB, path.to_string_lossy().to_string());
    std::fs::remove_file(&path).ok();
    assert!(result.is_err());
}
