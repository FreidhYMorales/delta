//! `mealy_apply`/`mealy_snapshot`/`mealy_undo`/`mealy_redo`/`mealy_save`/
//! `mealy_open`/`mealy_sim` over a real `MealySession` — same shape as
//! `tests/doc_apply.rs`, for the Mealy IPC layer (`src/mealy_ipc.rs`,
//! `src/commands/mealy.rs`). `diff_patches` there is the one piece of
//! genuinely new, non-trivial logic this round adds with nothing upstream
//! already exercising it (unlike every `commands::mealy` function, which
//! just calls straight into `MealyDocument`, already covered by
//! `mealy_doc.rs`'s own round-trip proptest in `automata-core`).

use app_lib::commands::mealy;
use app_lib::mealy_ipc::{MealyDocPatch, MealyEdgeView, MealyEditOpDto};
use app_lib::state::{MealySession, SEEDED_TAB_ID};

fn ops(entries: &[MealyEditOpDto]) -> Vec<MealyEditOpDto> {
    entries.to_vec()
}

#[test]
fn apply_reports_exactly_the_expected_patches_and_bumps_the_revision() {
    let session = MealySession::new();
    let result =
        mealy::apply(&session, SEEDED_TAB_ID, ops(&[MealyEditOpDto::AddState { label: "q0".into(), x: 1.0, y: 2.0 }]))
            .unwrap();

    assert_eq!(result.revision, 1);
    assert_eq!(result.patches.len(), 1);
    assert!(matches!(
        &result.patches[0],
        MealyDocPatch::StateAdded { label, x, y, .. } if label == "q0" && *x == 1.0 && *y == 2.0
    ));
}

#[test]
fn snapshot_reflects_states_transitions_and_derived_facts_after_apply() {
    let session = MealySession::new();
    mealy::apply(
        &session,
        SEEDED_TAB_ID,
        ops(&[
            MealyEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            MealyEditOpDto::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ]),
    )
    .unwrap();
    let snap = mealy::snapshot(&session, SEEDED_TAB_ID).unwrap();
    let q0 = snap.states.iter().find(|s| s.label == "q0").unwrap().id;
    let q1 = snap.states.iter().find(|s| s.label == "q1").unwrap().id;

    mealy::apply(
        &session,
        SEEDED_TAB_ID,
        ops(&[
            MealyEditOpDto::SetInitial { id: Some(q0) },
            MealyEditOpDto::SetTransitions { from: q0, to: q1, entries: vec![("a".into(), "x".into())] },
        ]),
    )
    .unwrap();

    let snap = mealy::snapshot(&session, SEEDED_TAB_ID).unwrap();
    assert_eq!(snap.revision, 2);
    assert!(snap.states.iter().find(|s| s.id == q0).unwrap().initial);
    assert_eq!(snap.edges, vec![MealyEdgeView { from: q0, to: q1, transitions: vec![("a".into(), "x".into())] }]);
    assert_eq!(snap.derived.input_alphabet, vec!["a".to_string()]);
    assert_eq!(snap.derived.output_alphabet, vec!["x".to_string()]);
    assert!(snap.derived.deterministic);
}

#[test]
fn undo_reverses_the_most_recent_apply_and_redo_reapplies_it() {
    let session = MealySession::new();
    mealy::apply(&session, SEEDED_TAB_ID, ops(&[MealyEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }])).unwrap();
    assert_eq!(mealy::snapshot(&session, SEEDED_TAB_ID).unwrap().states.len(), 1);

    let undone = mealy::undo(&session, SEEDED_TAB_ID).unwrap().expect("there is a transaction to undo");
    assert_eq!(undone.revision, 2);
    assert!(matches!(&undone.patches[0], MealyDocPatch::StateRemoved { .. }));
    assert_eq!(mealy::snapshot(&session, SEEDED_TAB_ID).unwrap().states.len(), 0);

    let redone = mealy::redo(&session, SEEDED_TAB_ID).unwrap().expect("there is a transaction to redo");
    assert_eq!(redone.revision, 3);
    assert_eq!(mealy::snapshot(&session, SEEDED_TAB_ID).unwrap().states.len(), 1);
}

#[test]
fn undo_on_a_fresh_session_is_none() {
    let session = MealySession::new();
    assert!(mealy::undo(&session, SEEDED_TAB_ID).unwrap().is_none());
}

#[test]
fn save_then_open_round_trips_the_document() {
    let session = MealySession::new();
    mealy::apply(&session, SEEDED_TAB_ID, ops(&[MealyEditOpDto::AddState { label: "q0".into(), x: 3.0, y: 4.0 }])).unwrap();
    let path = std::env::temp_dir().join(format!("mealy-ipc-test-{}.json", std::process::id()));
    let path_str = path.to_str().unwrap().to_string();

    mealy::save(&session, SEEDED_TAB_ID, path_str.clone()).unwrap();

    let fresh_session = MealySession::new();
    let loaded = mealy::open(&fresh_session, SEEDED_TAB_ID, path_str).unwrap();
    std::fs::remove_file(&path).ok();

    assert_eq!(loaded.states.len(), 1);
    assert_eq!(loaded.states[0].label, "q0");
    assert_eq!((loaded.states[0].x, loaded.states[0].y), (3.0, 4.0));
}

#[test]
fn sim_runs_the_current_document_and_reports_the_output() {
    let session = MealySession::new();
    mealy::apply(
        &session,
        SEEDED_TAB_ID,
        ops(&[
            MealyEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            MealyEditOpDto::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ]),
    )
    .unwrap();
    let q0 = mealy::snapshot(&session, SEEDED_TAB_ID).unwrap().states.iter().find(|s| s.label == "q0").unwrap().id;
    let q1 = mealy::snapshot(&session, SEEDED_TAB_ID).unwrap().states.iter().find(|s| s.label == "q1").unwrap().id;
    mealy::apply(
        &session,
        SEEDED_TAB_ID,
        ops(&[
            MealyEditOpDto::SetInitial { id: Some(q0) },
            MealyEditOpDto::SetTransitions { from: q0, to: q1, entries: vec![("a".into(), "x".into())] },
        ]),
    )
    .unwrap();

    let outcome = mealy::sim(&session, SEEDED_TAB_ID, vec!["a".to_string()]).unwrap();
    assert_eq!(outcome, mealy::MealySimDto::Completed { outputs: vec!["x".to_string()] });
}
