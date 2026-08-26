//! PR4 of the `multi-tab-projects` change: FA's 16 commands (`doc.rs`,
//! `sim.rs`, `jff.rs`, `convert.rs`) now take a resolved `TabId` (design D3),
//! looked up via `Session`'s fallible `try_with`/`try_with_mut` helpers
//! instead of the hardcoded `SEEDED_TAB_ID`. This file proves the two new
//! properties that migration adds:
//!
//! 1. Editing one tab never leaks into another tab's document.
//! 2. An unknown/forged `TabId` is a clean `Err`, never a panic — since
//!    `Session::with`/`with_mut` (unlike `try_with`/`try_with_mut`) still
//!    `.expect()` on a missing id, every one of the 16 commands must go
//!    through the fallible helpers, not the panicking ones.

use app_lib::commands::{convert, doc, jff, sim};
use app_lib::ipc::EditOpDto;
use app_lib::state::Session;
use app_lib::tabs::TabId;
use automata_core::doc::Document as CoreDocument;

/// A `TabId` never allocated in any of these tests' sessions.
const UNKNOWN_TAB: TabId = TabId(999);

#[test]
fn doc_apply_on_one_tab_does_not_affect_a_second_tabs_document() {
    let session = Session::new();
    let tab_a = TabId(0); // the seeded tab
    let tab_b = TabId(1);
    session.insert(tab_b, CoreDocument::new());

    doc::apply(&session, tab_a, vec![EditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }])
        .expect("apply on tab A must succeed");

    let snap_a = doc::snapshot(&session, tab_a).unwrap();
    let snap_b = doc::snapshot(&session, tab_b).unwrap();
    assert_eq!(snap_a.states.len(), 1, "tab A must have received the edit");
    assert_eq!(snap_b.states.len(), 0, "tab B must be completely unaffected");
}

#[test]
fn sim_trace_on_one_tab_only_sees_that_tabs_document() {
    let session = Session::new();
    let tab_a = TabId(0);
    let tab_b = TabId(1);
    session.insert(tab_b, CoreDocument::new());

    // Build an accepting one-state self-loop DFA on tab A only.
    let r = doc::apply(&session, tab_a, vec![EditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]).unwrap();
    let q0 = match &r.patches[0] {
        app_lib::ipc::DocPatch::StateAdded { id, .. } => *id,
        _ => panic!("expected StateAdded"),
    };
    doc::apply(
        &session,
        tab_a,
        vec![
            EditOpDto::SetInitial { id: Some(q0) },
            EditOpDto::SetAccepting { id: q0, accepting: true },
        ],
    )
    .unwrap();

    let trace_a = sim::trace(&session, tab_a, vec![], None).unwrap();
    assert_eq!(trace_a.outcome, "Accepted", "tab A has an initial+accepting state");

    // Tab B is still the fresh empty document: no initial state at all, so
    // the engine can't even start (`Stuck`) — proves tab A's edits never
    // reached tab B.
    let trace_b = sim::trace(&session, tab_b, vec![], None).unwrap();
    assert_eq!(trace_b.outcome, "Stuck", "tab B must remain the untouched empty document");
}

#[test]
fn jff_import_on_one_tab_does_not_affect_a_second_tabs_document() {
    let session = Session::new();
    let tab_a = TabId(0);
    let tab_b = TabId(1);
    session.insert(tab_b, CoreDocument::new());

    let fixture = concat!(env!("CARGO_MANIFEST_DIR"), "/../crates/automata-core/tests/fixtures/jff/").to_string()
        + "dfa.jff";
    jff::import(&session, tab_a, fixture).expect("import on tab A must succeed");

    let snap_a = doc::snapshot(&session, tab_a).unwrap();
    let snap_b = doc::snapshot(&session, tab_b).unwrap();
    assert_eq!(snap_a.states.len(), 3, "tab A must have the imported document");
    assert_eq!(snap_b.states.len(), 0, "tab B must be completely unaffected by the import");
}

#[test]
fn doc_snapshot_on_an_unknown_tab_id_is_an_err_not_a_panic() {
    let session = Session::new();
    assert!(doc::snapshot(&session, UNKNOWN_TAB).is_err());
}

#[test]
fn doc_apply_on_an_unknown_tab_id_is_an_err_not_a_panic() {
    let session = Session::new();
    let result = doc::apply(&session, UNKNOWN_TAB, vec![EditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]);
    assert!(result.is_err());
}

#[test]
fn doc_undo_and_redo_on_an_unknown_tab_id_are_err_not_a_panic() {
    let session = Session::new();
    assert!(doc::undo(&session, UNKNOWN_TAB).is_err());
    assert!(doc::redo(&session, UNKNOWN_TAB).is_err());
}

#[test]
fn sim_trace_and_batch_on_an_unknown_tab_id_are_err_not_a_panic() {
    let session = Session::new();
    assert!(sim::trace(&session, UNKNOWN_TAB, vec![], None).is_err());
    assert!(sim::batch(&session, UNKNOWN_TAB, vec![vec![]], None).is_err());
}

#[test]
fn jff_export_on_an_unknown_tab_id_is_an_err_not_a_panic() {
    let session = Session::new();
    let dir = std::env::temp_dir();
    let path = dir.join(format!("jflap-unknown-tab-export-{}.jff", std::process::id()));
    let result = jff::export(&session, UNKNOWN_TAB, path.to_string_lossy().to_string());
    assert!(result.is_err());
}

#[test]
fn convert_to_regex_and_to_grammar_on_an_unknown_tab_id_are_err_not_a_panic() {
    let session = Session::new();
    assert!(convert::to_regex(&session, UNKNOWN_TAB).is_err());
    assert!(convert::to_grammar(&session, UNKNOWN_TAB).is_err());
    assert!(convert::nfa_to_dfa_preview(&session, UNKNOWN_TAB).is_err());
    assert!(convert::minimize_dfa_preview(&session, UNKNOWN_TAB).is_err());
}

#[test]
fn convert_from_regex_and_from_grammar_on_an_unknown_tab_id_are_err_not_a_panic() {
    let session = Session::new();
    assert!(convert::from_regex(&session, UNKNOWN_TAB, "a".to_string()).is_err());
    assert!(convert::from_grammar(&session, UNKNOWN_TAB, "S -> a".to_string()).is_err());
}
