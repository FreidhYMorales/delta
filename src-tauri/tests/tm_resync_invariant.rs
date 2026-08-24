//! Same core IPC resync invariant as `tests/pda_resync_invariant.rs`, for
//! the TM IPC layer: replaying every `TmDocPatch` onto a patch-applied
//! mirror seeded from an initial `tm_snapshot` MUST equal calling
//! `tm_snapshot` again fresh after the same edits.

use app_lib::commands::tm;
use app_lib::state::TmSession;
use app_lib::tm_ipc::{TmDocMirror, TmEditOpDto};
use automata_core::dto::TmTapeOpDto;

fn tape_op(read: &str, write: &str, direction: &str) -> TmTapeOpDto {
    TmTapeOpDto { read: read.into(), write: write.into(), direction: direction.into() }
}

#[test]
fn replayed_patches_equal_a_freshly_recomputed_snapshot() {
    let session = TmSession::new();

    let initial_snapshot = tm::snapshot(&session);
    let mut mirror = TmDocMirror::from_snapshot(&initial_snapshot);

    // A representative sequence spanning every TmDocPatch kind: add,
    // initial, accepting, transition add/edit, rename, move, and
    // (indirectly) a derived-facts (alphabet/tape_count) change.
    let batches: Vec<Vec<TmEditOpDto>> = vec![
        vec![
            TmEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            TmEditOpDto::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ],
        vec![TmEditOpDto::SetInitial { id: Some(0) }],
        vec![TmEditOpDto::SetAccepting { id: 1, accepting: true }],
        vec![TmEditOpDto::AddTransition { from: 0, to: 1, tapes: vec![tape_op("a", "b", "R")] }],
        vec![TmEditOpDto::AddTransition { from: 0, to: 1, tapes: vec![tape_op("b", "a", "L")] }],
        vec![TmEditOpDto::EditTransition { id: 0, tapes: vec![tape_op("c", "c", "S")] }],
        vec![TmEditOpDto::RenameState { id: 1, label: "target".into() }],
        vec![TmEditOpDto::MoveState { id: 0, x: 5.0, y: 5.0 }],
        vec![TmEditOpDto::RemoveTransition { id: 1 }],
    ];

    for ops in batches {
        let result = tm::apply(&session, ops).expect("apply must succeed");
        mirror.apply(&result.patches);
    }

    let fresh_snapshot = tm::snapshot(&session);

    let mut mirror_states = mirror.states_sorted();
    mirror_states.sort_by_key(|s| s.id);
    let mut fresh_states = fresh_snapshot.states.clone();
    fresh_states.sort_by_key(|s| s.id);
    assert_eq!(mirror_states, fresh_states);

    let mut mirror_transitions = mirror.transitions_sorted();
    mirror_transitions.sort_by_key(|t| t.id);
    let mut fresh_transitions = fresh_snapshot.transitions.clone();
    fresh_transitions.sort_by_key(|t| t.id);
    assert_eq!(mirror_transitions, fresh_transitions);
}

#[test]
fn replayed_patches_equal_snapshot_after_a_state_removal_cascading_its_transitions() {
    let session = TmSession::new();
    let mut mirror = TmDocMirror::from_snapshot(&tm::snapshot(&session));

    let r1 = tm::apply(
        &session,
        vec![
            TmEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            TmEditOpDto::AddState { label: "q1".into(), x: 1.0, y: 1.0 },
        ],
    )
    .unwrap();
    mirror.apply(&r1.patches);

    let r2 = tm::apply(&session, vec![TmEditOpDto::AddTransition { from: 0, to: 1, tapes: vec![tape_op("a", "a", "R")] }])
        .unwrap();
    mirror.apply(&r2.patches);

    let r3 = tm::apply(&session, vec![TmEditOpDto::RemoveState { id: 0 }]).unwrap();
    mirror.apply(&r3.patches);

    let fresh = tm::snapshot(&session);
    let mut mirror_states = mirror.states_sorted();
    mirror_states.sort_by_key(|s| s.id);
    let mut fresh_states = fresh.states.clone();
    fresh_states.sort_by_key(|s| s.id);
    assert_eq!(mirror_states, fresh_states);
    // The removed state cascaded its incident transition away too.
    assert!(mirror.transitions_sorted().is_empty());
    assert!(fresh.transitions.is_empty());
}

#[test]
fn replayed_patches_equal_snapshot_across_a_two_tape_transition_add() {
    let session = TmSession::new();
    let mut mirror = TmDocMirror::from_snapshot(&tm::snapshot(&session));

    let r1 = tm::apply(
        &session,
        vec![
            TmEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            TmEditOpDto::AddState { label: "q1".into(), x: 1.0, y: 1.0 },
        ],
    )
    .unwrap();
    mirror.apply(&r1.patches);

    let r2 = tm::apply(
        &session,
        vec![TmEditOpDto::AddTransition {
            from: 0,
            to: 1,
            tapes: vec![tape_op("a", "a", "R"), tape_op("b", "b", "L")],
        }],
    )
    .unwrap();
    mirror.apply(&r2.patches);

    let fresh = tm::snapshot(&session);
    let mut mirror_transitions = mirror.transitions_sorted();
    mirror_transitions.sort_by_key(|t| t.id);
    let mut fresh_transitions = fresh.transitions.clone();
    fresh_transitions.sort_by_key(|t| t.id);
    assert_eq!(mirror_transitions, fresh_transitions);
    assert_eq!(fresh.derived.tape_count, 2);
}
