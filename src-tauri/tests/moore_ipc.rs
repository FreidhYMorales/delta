//! `moore_apply`/`moore_snapshot`/`moore_undo`/`moore_redo`/`moore_save`/
//! `moore_open`/`moore_sim` over a real `MooreSession` — same shape as
//! `tests/mealy_ipc.rs`, for the Moore IPC layer (`src/moore_ipc.rs`,
//! `src/commands/moore.rs`). `diff_patches` there is the one piece of
//! genuinely new, non-trivial logic this round adds with nothing upstream
//! already exercising it (unlike every `commands::moore` function, which
//! just calls straight into `MooreDocument`, already covered by
//! `moore_doc.rs`'s own round-trip proptest in `automata-core`).

use app_lib::commands::moore;
use app_lib::moore_ipc::{MooreDocPatch, MooreEdgeView, MooreEditOpDto};
use app_lib::state::MooreSession;

fn ops(entries: &[MooreEditOpDto]) -> Vec<MooreEditOpDto> {
    entries.to_vec()
}

#[test]
fn apply_reports_exactly_the_expected_patches_and_bumps_the_revision() {
    let session = MooreSession::new();
    let result = moore::apply(&session, ops(&[MooreEditOpDto::AddState { label: "q0".into(), x: 1.0, y: 2.0 }])).unwrap();

    assert_eq!(result.revision, 1);
    assert_eq!(result.patches.len(), 1);
    assert!(matches!(
        &result.patches[0],
        MooreDocPatch::StateAdded { label, x, y, .. } if label == "q0" && *x == 1.0 && *y == 2.0
    ));
}

#[test]
fn snapshot_reflects_states_transitions_output_and_derived_facts_after_apply() {
    let session = MooreSession::new();
    moore::apply(
        &session,
        ops(&[
            MooreEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            MooreEditOpDto::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ]),
    )
    .unwrap();
    let snap = moore::snapshot(&session);
    let q0 = snap.states.iter().find(|s| s.label == "q0").unwrap().id;
    let q1 = snap.states.iter().find(|s| s.label == "q1").unwrap().id;

    moore::apply(
        &session,
        ops(&[
            MooreEditOpDto::SetInitial { id: Some(q0) },
            MooreEditOpDto::SetOutput { state: q0, output: Some("even".into()) },
            MooreEditOpDto::SetOutput { state: q1, output: Some("odd".into()) },
            MooreEditOpDto::SetTransitions { from: q0, to: q1, inputs: vec!["a".into()] },
        ]),
    )
    .unwrap();

    let snap = moore::snapshot(&session);
    assert_eq!(snap.revision, 2);
    let s0 = snap.states.iter().find(|s| s.id == q0).unwrap();
    assert!(s0.initial);
    assert_eq!(s0.output, Some("even".to_string()));
    assert_eq!(snap.states.iter().find(|s| s.id == q1).unwrap().output, Some("odd".to_string()));
    assert_eq!(snap.edges, vec![MooreEdgeView { from: q0, to: q1, inputs: vec!["a".to_string()] }]);
    assert_eq!(snap.derived.input_alphabet, vec!["a".to_string()]);
    let mut output_alphabet = snap.derived.output_alphabet.clone();
    output_alphabet.sort();
    assert_eq!(output_alphabet, vec!["even".to_string(), "odd".to_string()]);
    assert!(snap.derived.deterministic);
}

#[test]
fn undo_reverses_the_most_recent_apply_and_redo_reapplies_it() {
    let session = MooreSession::new();
    moore::apply(&session, ops(&[MooreEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }])).unwrap();
    assert_eq!(moore::snapshot(&session).states.len(), 1);

    let undone = moore::undo(&session).expect("there is a transaction to undo");
    assert_eq!(undone.revision, 2);
    assert!(matches!(&undone.patches[0], MooreDocPatch::StateRemoved { .. }));
    assert_eq!(moore::snapshot(&session).states.len(), 0);

    let redone = moore::redo(&session).expect("there is a transaction to redo");
    assert_eq!(redone.revision, 3);
    assert_eq!(moore::snapshot(&session).states.len(), 1);
}

#[test]
fn undo_on_a_fresh_session_is_none() {
    let session = MooreSession::new();
    assert!(moore::undo(&session).is_none());
}

#[test]
fn save_then_open_round_trips_the_document() {
    let session = MooreSession::new();
    moore::apply(&session, ops(&[MooreEditOpDto::AddState { label: "q0".into(), x: 3.0, y: 4.0 }])).unwrap();
    let path = std::env::temp_dir().join(format!("moore-ipc-test-{}.json", std::process::id()));
    let path_str = path.to_str().unwrap().to_string();

    moore::save(&session, path_str.clone()).unwrap();

    let fresh_session = MooreSession::new();
    let loaded = moore::open(&fresh_session, path_str).unwrap();
    std::fs::remove_file(&path).ok();

    assert_eq!(loaded.states.len(), 1);
    assert_eq!(loaded.states[0].label, "q0");
    assert_eq!((loaded.states[0].x, loaded.states[0].y), (3.0, 4.0));
}

#[test]
fn sim_runs_the_current_document_and_reports_output_len_input_plus_one() {
    let session = MooreSession::new();
    moore::apply(
        &session,
        ops(&[
            MooreEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            MooreEditOpDto::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ]),
    )
    .unwrap();
    let q0 = moore::snapshot(&session).states.iter().find(|s| s.label == "q0").unwrap().id;
    let q1 = moore::snapshot(&session).states.iter().find(|s| s.label == "q1").unwrap().id;
    moore::apply(
        &session,
        ops(&[
            MooreEditOpDto::SetInitial { id: Some(q0) },
            MooreEditOpDto::SetOutput { state: q0, output: Some("even".into()) },
            MooreEditOpDto::SetOutput { state: q1, output: Some("odd".into()) },
            MooreEditOpDto::SetTransitions { from: q0, to: q1, inputs: vec!["a".into()] },
        ]),
    )
    .unwrap();

    let outcome = moore::sim(&session, vec!["a".to_string()]);
    // Moore emits the initial state's output before consuming anything, so
    // a 1-symbol input yields a 2-entry output sequence.
    assert_eq!(outcome, moore::MooreSimDto::Completed { outputs: vec!["even".to_string(), "odd".to_string()] });
}
