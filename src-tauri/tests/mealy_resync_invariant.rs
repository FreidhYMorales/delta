//! Same core IPC resync invariant as `tests/resync_invariant.rs`, for the
//! Mealy IPC layer: replaying every `MealyDocPatch` onto a patch-applied
//! mirror seeded from an initial `mealy_snapshot` MUST equal calling
//! `mealy_snapshot` again fresh after the same edits.

use app_lib::commands::mealy;
use app_lib::mealy_ipc::{MealyDocMirror, MealyEditOpDto};
use app_lib::state::{MealySession, SEEDED_TAB_ID};

#[test]
fn replayed_patches_equal_a_freshly_recomputed_snapshot() {
    let session = MealySession::new();

    let initial_snapshot = mealy::snapshot(&session, SEEDED_TAB_ID).unwrap();
    let mut mirror = MealyDocMirror::from_snapshot(&initial_snapshot);

    // A representative sequence spanning every MealyDocPatch kind: add,
    // initial, transitions, rename, move, and (indirectly) alphabet change.
    let batches: Vec<Vec<MealyEditOpDto>> = vec![
        vec![
            MealyEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            MealyEditOpDto::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ],
        vec![MealyEditOpDto::SetInitial { id: Some(0) }],
        vec![MealyEditOpDto::SetTransitions {
            from: 0,
            to: 1,
            entries: vec![("a".into(), "x".into()), ("b".into(), "y".into())],
        }],
        vec![MealyEditOpDto::RenameState { id: 1, label: "accept".into() }],
        vec![MealyEditOpDto::MoveState { id: 0, x: 5.0, y: 5.0 }],
        vec![MealyEditOpDto::SetTransitions { from: 0, to: 1, entries: vec![("a".into(), "x".into())] }],
    ];

    for ops in batches {
        let result = mealy::apply(&session, SEEDED_TAB_ID, ops).expect("apply must succeed");
        mirror.apply(&result.patches);
    }

    let fresh_snapshot = mealy::snapshot(&session, SEEDED_TAB_ID).unwrap();

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
    let session = MealySession::new();
    let mut mirror = MealyDocMirror::from_snapshot(&mealy::snapshot(&session, SEEDED_TAB_ID).unwrap());

    let r1 = mealy::apply(
        &session,
        SEEDED_TAB_ID,
        vec![
            MealyEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            MealyEditOpDto::AddState { label: "q1".into(), x: 1.0, y: 1.0 },
        ],
    )
    .unwrap();
    mirror.apply(&r1.patches);

    let r2 = mealy::apply(
        &session,
        SEEDED_TAB_ID,
        vec![MealyEditOpDto::SetTransitions { from: 0, to: 1, entries: vec![("a".into(), "x".into())] }],
    )
    .unwrap();
    mirror.apply(&r2.patches);

    let r3 = mealy::apply(&session, SEEDED_TAB_ID, vec![MealyEditOpDto::RemoveState { id: 0 }]).unwrap();
    mirror.apply(&r3.patches);

    let fresh = mealy::snapshot(&session, SEEDED_TAB_ID).unwrap();
    let mut mirror_states = mirror.states_sorted();
    mirror_states.sort_by_key(|s| s.id);
    let mut fresh_states = fresh.states.clone();
    fresh_states.sort_by_key(|s| s.id);
    assert_eq!(mirror_states, fresh_states);
    // The removed state cascaded its incident edge away too.
    assert!(mirror.edges_sorted().is_empty());
    assert!(fresh.edges.is_empty());
}
