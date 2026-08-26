//! Task 6.6 (RED) / 6.7 (GREEN): `jff_import`/`jff_export` return an
//! `InteropReport` over a real `Session`, reusing the `interop::jff`
//! reader/writer already proven in PR3 (`automata-core`).

use app_lib::commands::jff;
use app_lib::state::{Session, SEEDED_TAB_ID};

fn fixture(name: &str) -> String {
    concat!(env!("CARGO_MANIFEST_DIR"), "/../crates/automata-core/tests/fixtures/jff/").to_string() + name
}

#[test]
fn jff_import_replaces_the_session_document_and_returns_a_report() {
    let session = Session::new();
    let result = jff::import(&session, SEEDED_TAB_ID, fixture("dfa.jff")).expect("import must succeed");

    assert_eq!(result.snapshot.states.len(), 3);
    assert_eq!(result.report.direction, "Import");
    // dfa.jff is a clean DFA fixture: no lossy/dropped items expected.
    assert!(result
        .report
        .items
        .iter()
        .all(|i| i.severity == "Info"));
}

#[test]
fn jff_import_rejects_non_fa_types_with_a_clear_error_and_leaves_session_unchanged() {
    let session = Session::new();
    // Seed the session with one state so we can prove it is left untouched.
    app_lib::commands::doc::apply(
        &session,
        SEEDED_TAB_ID,
        vec![app_lib::ipc::EditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }],
    )
    .unwrap();

    let err = jff::import(&session, SEEDED_TAB_ID, fixture("reject_pda.jff")).unwrap_err();
    assert!(err.contains("pda") || err.to_lowercase().contains("unsupported"));

    let snap = app_lib::commands::doc::snapshot(&session, SEEDED_TAB_ID).unwrap();
    assert_eq!(snap.states.len(), 1, "session must be unchanged on a rejected import");
}

#[test]
fn jff_export_writes_a_reopenable_file_and_returns_a_report() {
    let session = Session::new();
    jff::import(&session, SEEDED_TAB_ID, fixture("dfa.jff")).unwrap();

    let dir = std::env::temp_dir();
    let path = dir.join(format!("jflap-jff-export-test-{}.jff", std::process::id()));
    let path_str = path.to_string_lossy().to_string();

    let report = jff::export(&session, SEEDED_TAB_ID, path_str.clone()).expect("export must succeed");
    assert_eq!(report.direction, "Export");

    let session2 = Session::new();
    let reimported = jff::import(&session2, SEEDED_TAB_ID, path_str.clone()).expect("exported file must re-import");
    assert_eq!(reimported.snapshot.states.len(), 3);

    let _ = std::fs::remove_file(path);
}
