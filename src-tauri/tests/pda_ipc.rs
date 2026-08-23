//! `pda_apply`/`pda_snapshot`/`pda_undo`/`pda_redo`/`pda_save`/`pda_open`/
//! `pda_sim` over a real `PdaSession` — same shape as `tests/moore_ipc.rs`,
//! for the PDA IPC layer (`src/pda_ipc.rs`, `src/commands/pda.rs`).
//! `diff_patches` is the one piece of genuinely new, non-trivial logic this
//! round adds with nothing upstream already exercising it (every
//! `commands::pda` function otherwise just calls straight into
//! `PdaDocument`, already covered by `pda_doc.rs`'s own round-trip proptest
//! in `automata-core`) — plus the transition-level (not edge-level) patch
//! shape, PDA's genuinely new case none of FA/Mealy/Moore had.

use app_lib::commands::pda;
use app_lib::pda_ipc::{PdaDocPatch, PdaEditOpDto};
use app_lib::state::PdaSession;

fn ops(entries: &[PdaEditOpDto]) -> Vec<PdaEditOpDto> {
    entries.to_vec()
}

#[test]
fn apply_reports_exactly_the_expected_patches_and_bumps_the_revision() {
    let session = PdaSession::new();
    let result = pda::apply(&session, ops(&[PdaEditOpDto::AddState { label: "q0".into(), x: 1.0, y: 2.0 }])).unwrap();

    assert_eq!(result.revision, 1);
    assert_eq!(result.patches.len(), 1);
    assert!(matches!(
        &result.patches[0],
        PdaDocPatch::StateAdded { label, x, y, .. } if label == "q0" && *x == 1.0 && *y == 2.0
    ));
}

#[test]
fn snapshot_reflects_states_transitions_accepting_and_derived_facts_after_apply() {
    let session = PdaSession::new();
    pda::apply(
        &session,
        ops(&[
            PdaEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            PdaEditOpDto::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ]),
    )
    .unwrap();
    let snap = pda::snapshot(&session);
    let q0 = snap.states.iter().find(|s| s.label == "q0").unwrap().id;
    let q1 = snap.states.iter().find(|s| s.label == "q1").unwrap().id;

    pda::apply(
        &session,
        ops(&[
            PdaEditOpDto::SetInitial { id: Some(q0) },
            PdaEditOpDto::SetAccepting { id: q1, accepting: true },
            PdaEditOpDto::AddTransition {
                from: q0,
                to: q1,
                input: Some("a".into()),
                pop: vec!["Z".into()],
                push: vec!["A".into(), "Z".into()],
            },
        ]),
    )
    .unwrap();

    let snap = pda::snapshot(&session);
    assert_eq!(snap.revision, 2);
    let s0 = snap.states.iter().find(|s| s.id == q0).unwrap();
    assert!(s0.initial);
    assert!(!s0.accepting);
    let s1 = snap.states.iter().find(|s| s.id == q1).unwrap();
    assert!(s1.accepting);
    assert_eq!(snap.transitions.len(), 1);
    let t = &snap.transitions[0];
    assert_eq!(t.from, q0);
    assert_eq!(t.to, q1);
    assert_eq!(t.input, Some("a".to_string()));
    assert_eq!(t.pop, vec!["Z".to_string()]);
    assert_eq!(t.push, vec!["A".to_string(), "Z".to_string()]);
    assert_eq!(snap.derived.input_alphabet, vec!["a".to_string()]);
    let mut stack_alphabet = snap.derived.stack_alphabet.clone();
    stack_alphabet.sort();
    assert_eq!(stack_alphabet, vec!["A".to_string(), "Z".to_string()]);
    assert!(snap.derived.deterministic);
}

#[test]
fn multiple_transitions_between_the_same_pair_of_states_survive_undo_redo_and_are_individually_addressable() {
    let session = PdaSession::new();
    pda::apply(
        &session,
        ops(&[
            PdaEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            PdaEditOpDto::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ]),
    )
    .unwrap();
    let q0 = pda::snapshot(&session).states.iter().find(|s| s.label == "q0").unwrap().id;
    let q1 = pda::snapshot(&session).states.iter().find(|s| s.label == "q1").unwrap().id;

    let r1 = pda::apply(
        &session,
        ops(&[PdaEditOpDto::AddTransition { from: q0, to: q1, input: Some("a".into()), pop: vec![], push: vec![] }]),
    )
    .unwrap();
    let r2 = pda::apply(
        &session,
        ops(&[PdaEditOpDto::AddTransition { from: q0, to: q1, input: Some("b".into()), pop: vec![], push: vec![] }]),
    )
    .unwrap();

    let t1_id = match &r1.patches[0] {
        PdaDocPatch::TransitionAdded { id, .. } => *id,
        other => panic!("expected TransitionAdded, got {other:?}"),
    };
    let t2_id = match &r2.patches[0] {
        PdaDocPatch::TransitionAdded { id, .. } => *id,
        other => panic!("expected TransitionAdded, got {other:?}"),
    };
    assert_ne!(t1_id, t2_id, "two transitions sharing (from, to) must get distinct ids");

    let snap = pda::snapshot(&session);
    assert_eq!(snap.transitions.len(), 2);
    assert!(snap.transitions.iter().all(|t| t.from == q0 && t.to == q1));

    // Editing one must not disturb the other.
    let r3 = pda::apply(
        &session,
        ops(&[PdaEditOpDto::EditTransition { id: t1_id, input: Some("c".into()), pop: vec![], push: vec![] }]),
    )
    .unwrap();
    assert!(matches!(&r3.patches[0], PdaDocPatch::TransitionEdited { id, input, .. } if *id == t1_id && input.as_deref() == Some("c")));
    let snap = pda::snapshot(&session);
    assert_eq!(snap.transitions.iter().find(|t| t.id == t1_id).unwrap().input, Some("c".to_string()));
    assert_eq!(snap.transitions.iter().find(|t| t.id == t2_id).unwrap().input, Some("b".to_string()));

    // Undo the edit, then undo both adds, then redo everything back.
    assert!(pda::undo(&session).is_some());
    assert_eq!(pda::snapshot(&session).transitions.iter().find(|t| t.id == t1_id).unwrap().input, Some("a".to_string()));
    assert!(pda::undo(&session).is_some());
    assert_eq!(pda::snapshot(&session).transitions.len(), 1);
    assert!(pda::undo(&session).is_some());
    assert_eq!(pda::snapshot(&session).transitions.len(), 0);

    assert!(pda::redo(&session).is_some());
    assert!(pda::redo(&session).is_some());
    assert!(pda::redo(&session).is_some());
    let snap = pda::snapshot(&session);
    assert_eq!(snap.transitions.len(), 2);
    assert_eq!(snap.transitions.iter().find(|t| t.id == t1_id).unwrap().input, Some("c".to_string()));
    assert_eq!(snap.transitions.iter().find(|t| t.id == t2_id).unwrap().input, Some("b".to_string()));
}

#[test]
fn undo_reverses_the_most_recent_apply_and_redo_reapplies_it() {
    let session = PdaSession::new();
    pda::apply(&session, ops(&[PdaEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }])).unwrap();
    assert_eq!(pda::snapshot(&session).states.len(), 1);

    let undone = pda::undo(&session).expect("there is a transaction to undo");
    assert_eq!(undone.revision, 2);
    assert!(matches!(&undone.patches[0], PdaDocPatch::StateRemoved { .. }));
    assert_eq!(pda::snapshot(&session).states.len(), 0);

    let redone = pda::redo(&session).expect("there is a transaction to redo");
    assert_eq!(redone.revision, 3);
    assert_eq!(pda::snapshot(&session).states.len(), 1);
}

#[test]
fn undo_on_a_fresh_session_is_none() {
    let session = PdaSession::new();
    assert!(pda::undo(&session).is_none());
}

#[test]
fn save_then_open_round_trips_the_document() {
    let session = PdaSession::new();
    pda::apply(&session, ops(&[PdaEditOpDto::AddState { label: "q0".into(), x: 3.0, y: 4.0 }])).unwrap();
    let path = std::env::temp_dir().join(format!("pda-ipc-test-{}.json", std::process::id()));
    let path_str = path.to_str().unwrap().to_string();

    pda::save(&session, path_str.clone()).unwrap();

    let fresh_session = PdaSession::new();
    let loaded = pda::open(&fresh_session, path_str).unwrap();
    std::fs::remove_file(&path).ok();

    assert_eq!(loaded.states.len(), 1);
    assert_eq!(loaded.states[0].label, "q0");
    assert_eq!((loaded.states[0].x, loaded.states[0].y), (3.0, 4.0));
}

#[test]
fn sim_respects_accept_by_and_defaults_to_final_state() {
    let session = PdaSession::new();
    pda::apply(
        &session,
        ops(&[
            PdaEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            PdaEditOpDto::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ]),
    )
    .unwrap();
    let q0 = pda::snapshot(&session).states.iter().find(|s| s.label == "q0").unwrap().id;
    let q1 = pda::snapshot(&session).states.iter().find(|s| s.label == "q1").unwrap().id;
    pda::apply(
        &session,
        ops(&[
            PdaEditOpDto::SetInitial { id: Some(q0) },
            PdaEditOpDto::SetAccepting { id: q1, accepting: true },
            PdaEditOpDto::AddTransition { from: q0, to: q1, input: Some("a".into()), pop: vec![], push: vec!["A".into()] },
        ]),
    )
    .unwrap();

    // Final-state mode (the default): q1 is reached with input exhausted,
    // regardless of the leftover pushed "A" on the stack.
    let final_trace = pda::sim(&session, vec!["a".to_string()], None, None);
    assert_eq!(final_trace.outcome, "Accepted");

    // Empty-stack mode: the leftover "A" (plus the bottom "Z" marker) means
    // the stack is never empty, so this must reject.
    let empty_trace = pda::sim(&session, vec!["a".to_string()], Some(pda::AcceptByDto::Empty), None);
    assert_eq!(empty_trace.outcome, "Rejected");
}
