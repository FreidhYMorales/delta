//! Task 6.2 (RED) / 6.3 (GREEN): `doc_apply` over a real `Session` returns
//! `EditResult{revision, patches, derived}` and the patches reflect the
//! applied edits.

use app_lib::commands::doc;
use app_lib::ipc::{DocPatch, EditOpDto};
use app_lib::state::Session;

#[test]
fn apply_add_state_bumps_revision_and_emits_state_added_patch() {
    let session = Session::new();
    assert_eq!(doc::snapshot(&session).revision, 0);

    let result = doc::apply(
        &session,
        vec![EditOpDto::AddState { label: "q0".into(), x: 1.0, y: 2.0 }],
    )
    .expect("apply must succeed");

    assert_eq!(result.revision, 1);
    assert_eq!(result.patches.len(), 1);
    match &result.patches[0] {
        DocPatch::StateAdded { id: _, label, x, y } => {
            assert_eq!(label, "q0");
            assert_eq!(*x, 1.0);
            assert_eq!(*y, 2.0);
        }
        other => panic!("expected StateAdded, got {other:?}"),
    }
    assert_eq!(result.derived.classification, "Dfa");
}

#[test]
fn apply_sets_initial_and_accepting_flags_and_edge() {
    let session = Session::new();
    let r1 = doc::apply(
        &session,
        vec![
            EditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            EditOpDto::AddState { label: "q1".into(), x: 1.0, y: 1.0 },
        ],
    )
    .unwrap();

    let ids: Vec<u32> = r1
        .patches
        .iter()
        .filter_map(|p| match p {
            DocPatch::StateAdded { id, .. } => Some(*id),
            _ => None,
        })
        .collect();
    assert_eq!(ids.len(), 2);
    let (q0, q1) = (ids[0], ids[1]);

    let r2 = doc::apply(
        &session,
        vec![
            EditOpDto::SetInitial { id: Some(q0) },
            EditOpDto::SetAccepting { id: q1, accepting: true },
            EditOpDto::SetEdge { from: q0, to: q1, epsilon: false, symbols: vec!["a".into()] },
        ],
    )
    .unwrap();

    assert_eq!(r2.revision, 2);
    assert!(r2
        .patches
        .iter()
        .any(|p| matches!(p, DocPatch::StateFlagsSet { id, initial: true, .. } if *id == q0)));
    assert!(r2
        .patches
        .iter()
        .any(|p| matches!(p, DocPatch::StateFlagsSet { id, accepting: true, .. } if *id == q1)));
    assert!(r2.patches.iter().any(|p| matches!(
        p,
        DocPatch::EdgeSymbolsSet { from, to, epsilon: false, symbols } if *from == q0 && *to == q1 && symbols == &vec!["a".to_string()]
    )));
    assert!(r2
        .patches
        .iter()
        .any(|p| matches!(p, DocPatch::AlphabetSet { symbols } if symbols == &vec!["a".to_string()])));
    assert_eq!(r2.derived.alphabet, vec!["a".to_string()]);
}

#[test]
fn doc_snapshot_reflects_applied_state() {
    let session = Session::new();
    doc::apply(&session, vec![EditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]).unwrap();
    let snap = doc::snapshot(&session);
    assert_eq!(snap.revision, 1);
    assert_eq!(snap.states.len(), 1);
    assert_eq!(snap.states[0].label, "q0");
}

#[test]
fn undo_reverts_last_apply_and_redo_reapplies_it() {
    let session = Session::new();
    doc::apply(&session, vec![EditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]).unwrap();

    let undo_result = doc::undo(&session).expect("there is something to undo");
    assert_eq!(doc::snapshot(&session).states.len(), 0);
    assert!(undo_result
        .patches
        .iter()
        .any(|p| matches!(p, DocPatch::StateRemoved { .. })));

    let redo_result = doc::redo(&session).expect("there is something to redo");
    assert_eq!(doc::snapshot(&session).states.len(), 1);
    assert!(redo_result
        .patches
        .iter()
        .any(|p| matches!(p, DocPatch::StateAdded { .. })));

    assert!(doc::undo(&session).is_some());
    assert!(doc::undo(&session).is_none(), "nothing left to undo");
    assert!(doc::redo(&session).is_some());
    assert!(doc::redo(&session).is_none(), "nothing left to redo");
}

#[test]
fn save_then_open_round_trips_through_a_real_file() {
    let session = Session::new();
    doc::apply(
        &session,
        vec![
            EditOpDto::AddState { label: "q0".into(), x: 3.0, y: 4.0 },
            EditOpDto::SetInitial { id: Some(0) },
        ],
    )
    .unwrap();

    let dir = std::env::temp_dir();
    let path = dir.join(format!("jflap-doc-apply-test-{}.json", std::process::id()));
    let path_str = path.to_string_lossy().to_string();

    doc::save(&session, path_str.clone()).expect("save must succeed");

    let session2 = Session::new();
    let snap = doc::open(&session2, path_str.clone()).expect("open must succeed");
    assert_eq!(snap.states.len(), 1);
    assert_eq!(snap.states[0].label, "q0");
    assert!(snap.states[0].initial);

    let _ = std::fs::remove_file(path);
}
