//! Same core IPC resync invariant as `tests/resync_invariant.rs`/
//! `tests/mealy_resync_invariant.rs`, for the Moore IPC layer: replaying
//! every `MooreDocPatch` onto a patch-applied mirror seeded from an initial
//! `moore_snapshot` MUST equal calling `moore_snapshot` again fresh after
//! the same edits.

use app_lib::commands::moore;
use app_lib::moore_ipc::{MooreDocMirror, MooreEditOpDto};
use app_lib::state::{MooreSession, SEEDED_TAB_ID};

#[test]
fn replayed_patches_equal_a_freshly_recomputed_snapshot() {
    let session = MooreSession::new();

    let initial_snapshot = moore::snapshot(&session, SEEDED_TAB_ID).unwrap();
    let mut mirror = MooreDocMirror::from_snapshot(&initial_snapshot);

    // A representative sequence spanning every MooreDocPatch kind: add,
    // initial, output, transitions, rename, move, and (indirectly) alphabet
    // change.
    let batches: Vec<Vec<MooreEditOpDto>> = vec![
        vec![
            MooreEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            MooreEditOpDto::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ],
        vec![MooreEditOpDto::SetInitial { id: Some(0) }],
        vec![MooreEditOpDto::SetOutput { state: 0, output: Some("even".into()) }],
        vec![MooreEditOpDto::SetOutput { state: 1, output: Some("odd".into()) }],
        vec![MooreEditOpDto::SetTransitions { from: 0, to: 1, inputs: vec!["a".into(), "b".into()] }],
        vec![MooreEditOpDto::RenameState { id: 1, label: "target".into() }],
        vec![MooreEditOpDto::MoveState { id: 0, x: 5.0, y: 5.0 }],
        vec![MooreEditOpDto::SetTransitions { from: 0, to: 1, inputs: vec!["a".into()] }],
    ];

    for ops in batches {
        let result = moore::apply(&session, SEEDED_TAB_ID, ops).expect("apply must succeed");
        mirror.apply(&result.patches);
    }

    let fresh_snapshot = moore::snapshot(&session, SEEDED_TAB_ID).unwrap();

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
    let session = MooreSession::new();
    let mut mirror = MooreDocMirror::from_snapshot(&moore::snapshot(&session, SEEDED_TAB_ID).unwrap());

    let r1 = moore::apply(
        &session,
        SEEDED_TAB_ID,
        vec![
            MooreEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            MooreEditOpDto::AddState { label: "q1".into(), x: 1.0, y: 1.0 },
        ],
    )
    .unwrap();
    mirror.apply(&r1.patches);

    let r2 =
        moore::apply(&session, SEEDED_TAB_ID, vec![MooreEditOpDto::SetTransitions { from: 0, to: 1, inputs: vec!["a".into()] }])
            .unwrap();
    mirror.apply(&r2.patches);

    let r3 = moore::apply(&session, SEEDED_TAB_ID, vec![MooreEditOpDto::RemoveState { id: 0 }]).unwrap();
    mirror.apply(&r3.patches);

    let fresh = moore::snapshot(&session, SEEDED_TAB_ID).unwrap();
    let mut mirror_states = mirror.states_sorted();
    mirror_states.sort_by_key(|s| s.id);
    let mut fresh_states = fresh.states.clone();
    fresh_states.sort_by_key(|s| s.id);
    assert_eq!(mirror_states, fresh_states);
    // The removed state cascaded its incident edge away too.
    assert!(mirror.edges_sorted().is_empty());
    assert!(fresh.edges.is_empty());
}
