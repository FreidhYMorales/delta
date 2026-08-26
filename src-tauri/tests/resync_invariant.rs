//! Task 6.8: the core IPC resync invariant. `doc_apply` returns `DocPatch`es
//! (diffs), never full snapshots on the normal edit path (design D3).
//! Replaying every patch onto a patch-applied mirror seeded from an initial
//! `doc_snapshot` MUST equal calling `doc_snapshot` again fresh after the
//! same edits — i.e. the patch stream is a lossless encoding of the diff.

use app_lib::commands::doc;
use app_lib::ipc::{DocMirror, EditOpDto};
use app_lib::state::{Session, SEEDED_TAB_ID};

#[test]
fn replayed_patches_equal_a_freshly_recomputed_snapshot() {
    let session = Session::new();

    let initial_snapshot = doc::snapshot(&session, SEEDED_TAB_ID).unwrap();
    let mut mirror = DocMirror::from_snapshot(&initial_snapshot);

    // A representative sequence spanning every DocPatch kind: add, flags,
    // edge, rename, move, edge removal, and (indirectly) alphabet change.
    let batches: Vec<Vec<EditOpDto>> = vec![
        vec![
            EditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            EditOpDto::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ],
        vec![EditOpDto::SetInitial { id: Some(0) }, EditOpDto::SetAccepting { id: 1, accepting: true }],
        vec![EditOpDto::SetEdge { from: 0, to: 1, epsilon: false, symbols: vec!["a".into(), "b".into()] }],
        vec![EditOpDto::RenameState { id: 1, label: "accept".into() }],
        vec![EditOpDto::MoveState { id: 0, x: 5.0, y: 5.0 }],
        vec![EditOpDto::SetEdge { from: 0, to: 1, epsilon: false, symbols: vec!["a".into()] }],
    ];

    for ops in batches {
        let result = doc::apply(&session, SEEDED_TAB_ID, ops).expect("apply must succeed");
        mirror.apply(&result.patches);
    }

    let fresh_snapshot = doc::snapshot(&session, SEEDED_TAB_ID).unwrap();

    let mut mirror_states = mirror.states_sorted();
    mirror_states.sort_by_key(|s| s.id);
    let mut fresh_states = fresh_snapshot.states.clone();
    fresh_states.sort_by_key(|s| s.id);
    assert_eq!(mirror_states, fresh_states);

    let mut mirror_edges = mirror.edges_sorted();
    mirror_edges.sort_by_key(|e| (e.from, e.to));
    let mut fresh_edges = fresh_snapshot.edges.clone();
    fresh_edges.sort_by_key(|e| (e.from, e.to));
    assert_eq!(mirror_edges, fresh_edges);
}

#[test]
fn replayed_patches_equal_snapshot_after_a_state_removal() {
    let session = Session::new();
    let mut mirror = DocMirror::from_snapshot(&doc::snapshot(&session, SEEDED_TAB_ID).unwrap());

    let r1 = doc::apply(
        &session,
        SEEDED_TAB_ID,
        vec![
            EditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            EditOpDto::AddState { label: "q1".into(), x: 1.0, y: 1.0 },
        ],
    )
    .unwrap();
    mirror.apply(&r1.patches);

    let r2 = doc::apply(&session, SEEDED_TAB_ID, vec![EditOpDto::SetEdge { from: 0, to: 1, epsilon: false, symbols: vec!["a".into()] }])
        .unwrap();
    mirror.apply(&r2.patches);

    let r3 = doc::apply(&session, SEEDED_TAB_ID, vec![EditOpDto::RemoveState { id: 0 }]).unwrap();
    mirror.apply(&r3.patches);

    let fresh = doc::snapshot(&session, SEEDED_TAB_ID).unwrap();
    let mut mirror_states = mirror.states_sorted();
    mirror_states.sort_by_key(|s| s.id);
    let mut fresh_states = fresh.states.clone();
    fresh_states.sort_by_key(|s| s.id);
    assert_eq!(mirror_states, fresh_states);
    // The removed state cascaded its incident edge away too.
    assert!(mirror.edges_sorted().is_empty());
    assert!(fresh.edges.is_empty());
}
