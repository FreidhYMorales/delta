//! Same core IPC resync invariant as `tests/moore_resync_invariant.rs`, for
//! the PDA IPC layer: replaying every `PdaDocPatch` onto a patch-applied
//! mirror seeded from an initial `pda_snapshot` MUST equal calling
//! `pda_snapshot` again fresh after the same edits.

use app_lib::commands::pda;
use app_lib::pda_ipc::{PdaDocMirror, PdaEditOpDto};
use app_lib::state::PdaSession;

#[test]
fn replayed_patches_equal_a_freshly_recomputed_snapshot() {
    let session = PdaSession::new();

    let initial_snapshot = pda::snapshot(&session);
    let mut mirror = PdaDocMirror::from_snapshot(&initial_snapshot);

    // A representative sequence spanning every PdaDocPatch kind: add,
    // initial, accepting, transition add/edit, rename, move, and
    // (indirectly) alphabet change.
    let batches: Vec<Vec<PdaEditOpDto>> = vec![
        vec![
            PdaEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            PdaEditOpDto::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ],
        vec![PdaEditOpDto::SetInitial { id: Some(0) }],
        vec![PdaEditOpDto::SetAccepting { id: 1, accepting: true }],
        vec![PdaEditOpDto::AddTransition { from: 0, to: 1, input: Some("a".into()), pop: vec![], push: vec!["A".into()] }],
        vec![PdaEditOpDto::AddTransition { from: 0, to: 1, input: Some("b".into()), pop: vec![], push: vec![] }],
        vec![PdaEditOpDto::EditTransition { id: 0, input: Some("c".into()), pop: vec!["Z".into()], push: vec![] }],
        vec![PdaEditOpDto::RenameState { id: 1, label: "target".into() }],
        vec![PdaEditOpDto::MoveState { id: 0, x: 5.0, y: 5.0 }],
        vec![PdaEditOpDto::RemoveTransition { id: 1 }],
    ];

    for ops in batches {
        let result = pda::apply(&session, ops).expect("apply must succeed");
        mirror.apply(&result.patches);
    }

    let fresh_snapshot = pda::snapshot(&session);

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
    let session = PdaSession::new();
    let mut mirror = PdaDocMirror::from_snapshot(&pda::snapshot(&session));

    let r1 = pda::apply(
        &session,
        vec![
            PdaEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            PdaEditOpDto::AddState { label: "q1".into(), x: 1.0, y: 1.0 },
        ],
    )
    .unwrap();
    mirror.apply(&r1.patches);

    let r2 = pda::apply(
        &session,
        vec![PdaEditOpDto::AddTransition { from: 0, to: 1, input: Some("a".into()), pop: vec![], push: vec![] }],
    )
    .unwrap();
    mirror.apply(&r2.patches);

    let r3 = pda::apply(&session, vec![PdaEditOpDto::RemoveState { id: 0 }]).unwrap();
    mirror.apply(&r3.patches);

    let fresh = pda::snapshot(&session);
    let mut mirror_states = mirror.states_sorted();
    mirror_states.sort_by_key(|s| s.id);
    let mut fresh_states = fresh.states.clone();
    fresh_states.sort_by_key(|s| s.id);
    assert_eq!(mirror_states, fresh_states);
    // The removed state cascaded its incident transition away too.
    assert!(mirror.transitions_sorted().is_empty());
    assert!(fresh.transitions.is_empty());
}
