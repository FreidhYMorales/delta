//! `tm_apply`/`tm_snapshot`/`tm_undo`/`tm_redo`/`tm_save`/`tm_open`/`tm_sim`
//! over a real `TmSession` — same shape as `tests/pda_ipc.rs`, for the TM
//! IPC layer (`src/tm_ipc.rs`, `src/commands/tm.rs`). `diff_patches` is the
//! one piece of genuinely new, non-trivial logic this round adds with
//! nothing upstream already exercising it (every `commands::tm` function
//! otherwise just calls straight into `TmDocument`, already covered by
//! `tm_doc.rs`'s own round-trip proptest in `automata-core`) — plus the
//! per-tape `tapes: Vec<...>` payload PDA's single-tape shape didn't have.

use app_lib::commands::tm;
use app_lib::state::{SEEDED_TAB_ID, TmSession};
use app_lib::tm_ipc::{TmDocPatch, TmEditOpDto};
use automata_core::dto::TmTapeOpDto;

fn ops(entries: &[TmEditOpDto]) -> Vec<TmEditOpDto> {
    entries.to_vec()
}

fn tape_op(read: &str, write: &str, direction: &str) -> TmTapeOpDto {
    TmTapeOpDto { read: read.into(), write: write.into(), direction: direction.into() }
}

#[test]
fn apply_reports_exactly_the_expected_patches_and_bumps_the_revision() {
    let session = TmSession::new();
    let result = tm::apply(&session, SEEDED_TAB_ID, ops(&[TmEditOpDto::AddState { label: "q0".into(), x: 1.0, y: 2.0 }])).unwrap();

    assert_eq!(result.revision, 1);
    assert_eq!(result.patches.len(), 1);
    assert!(matches!(
        &result.patches[0],
        TmDocPatch::StateAdded { label, x, y, .. } if label == "q0" && *x == 1.0 && *y == 2.0
    ));
}

#[test]
fn snapshot_reflects_states_transitions_accepting_and_derived_facts_after_apply() {
    let session = TmSession::new();
    tm::apply(
        &session,
        SEEDED_TAB_ID,
        ops(&[
            TmEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            TmEditOpDto::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ]),
    )
    .unwrap();
    let snap = tm::snapshot(&session, SEEDED_TAB_ID).unwrap();
    let q0 = snap.states.iter().find(|s| s.label == "q0").unwrap().id;
    let q1 = snap.states.iter().find(|s| s.label == "q1").unwrap().id;

    tm::apply(
        &session,
        SEEDED_TAB_ID,
        ops(&[
            TmEditOpDto::SetInitial { id: Some(q0) },
            TmEditOpDto::SetAccepting { id: q1, accepting: true },
            TmEditOpDto::AddTransition { from: q0, to: q1, tapes: vec![tape_op("a", "b", "R")] },
        ]),
    )
    .unwrap();

    let snap = tm::snapshot(&session, SEEDED_TAB_ID).unwrap();
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
    assert_eq!(t.tapes.len(), 1);
    assert_eq!(t.tapes[0].read, "a");
    assert_eq!(t.tapes[0].write, "b");
    assert_eq!(t.tapes[0].direction, "R");
    let mut alphabet = snap.derived.alphabet.clone();
    alphabet.sort();
    assert_eq!(alphabet, vec!["a".to_string(), "b".to_string()]);
    assert_eq!(snap.derived.tape_count, 1);
    assert!(snap.derived.deterministic);
}

#[test]
fn multiple_transitions_between_the_same_pair_of_states_survive_undo_redo_and_are_individually_addressable() {
    let session = TmSession::new();
    tm::apply(
        &session,
        SEEDED_TAB_ID,
        ops(&[
            TmEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            TmEditOpDto::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ]),
    )
    .unwrap();
    let q0 = tm::snapshot(&session, SEEDED_TAB_ID).unwrap().states.iter().find(|s| s.label == "q0").unwrap().id;
    let q1 = tm::snapshot(&session, SEEDED_TAB_ID).unwrap().states.iter().find(|s| s.label == "q1").unwrap().id;

    let r1 = tm::apply(
        &session,
        SEEDED_TAB_ID,
        ops(&[TmEditOpDto::AddTransition { from: q0, to: q1, tapes: vec![tape_op("a", "a", "R")] }]),
    )
    .unwrap();
    let r2 = tm::apply(
        &session,
        SEEDED_TAB_ID,
        ops(&[TmEditOpDto::AddTransition { from: q0, to: q1, tapes: vec![tape_op("b", "b", "L")] }]),
    )
    .unwrap();

    let t1_id = match &r1.patches[0] {
        TmDocPatch::TransitionAdded { id, .. } => *id,
        other => panic!("expected TransitionAdded, got {other:?}"),
    };
    let t2_id = match &r2.patches[0] {
        TmDocPatch::TransitionAdded { id, .. } => *id,
        other => panic!("expected TransitionAdded, got {other:?}"),
    };
    assert_ne!(t1_id, t2_id, "two transitions sharing (from, to) must get distinct ids");

    let snap = tm::snapshot(&session, SEEDED_TAB_ID).unwrap();
    assert_eq!(snap.transitions.len(), 2);
    assert!(snap.transitions.iter().all(|t| t.from == q0 && t.to == q1));

    // Editing one must not disturb the other.
    let r3 = tm::apply(&session, SEEDED_TAB_ID, ops(&[TmEditOpDto::EditTransition { id: t1_id, tapes: vec![tape_op("c", "c", "S")] }]))
        .unwrap();
    assert!(matches!(&r3.patches[0], TmDocPatch::TransitionEdited { id, tapes, .. } if *id == t1_id && tapes[0].read == "c"));
    let snap = tm::snapshot(&session, SEEDED_TAB_ID).unwrap();
    assert_eq!(snap.transitions.iter().find(|t| t.id == t1_id).unwrap().tapes[0].read, "c");
    assert_eq!(snap.transitions.iter().find(|t| t.id == t2_id).unwrap().tapes[0].read, "b");

    // Undo the edit, then undo both adds, then redo everything back.
    assert!(tm::undo(&session, SEEDED_TAB_ID).unwrap().is_some());
    assert_eq!(tm::snapshot(&session, SEEDED_TAB_ID).unwrap().transitions.iter().find(|t| t.id == t1_id).unwrap().tapes[0].read, "a");
    assert!(tm::undo(&session, SEEDED_TAB_ID).unwrap().is_some());
    assert_eq!(tm::snapshot(&session, SEEDED_TAB_ID).unwrap().transitions.len(), 1);
    assert!(tm::undo(&session, SEEDED_TAB_ID).unwrap().is_some());
    assert_eq!(tm::snapshot(&session, SEEDED_TAB_ID).unwrap().transitions.len(), 0);

    assert!(tm::redo(&session, SEEDED_TAB_ID).unwrap().is_some());
    assert!(tm::redo(&session, SEEDED_TAB_ID).unwrap().is_some());
    assert!(tm::redo(&session, SEEDED_TAB_ID).unwrap().is_some());
    let snap = tm::snapshot(&session, SEEDED_TAB_ID).unwrap();
    assert_eq!(snap.transitions.len(), 2);
    assert_eq!(snap.transitions.iter().find(|t| t.id == t1_id).unwrap().tapes[0].read, "c");
    assert_eq!(snap.transitions.iter().find(|t| t.id == t2_id).unwrap().tapes[0].read, "b");
}

#[test]
fn undo_reverses_the_most_recent_apply_and_redo_reapplies_it() {
    let session = TmSession::new();
    tm::apply(&session, SEEDED_TAB_ID, ops(&[TmEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }])).unwrap();
    assert_eq!(tm::snapshot(&session, SEEDED_TAB_ID).unwrap().states.len(), 1);

    let undone = tm::undo(&session, SEEDED_TAB_ID).unwrap().expect("there is a transaction to undo");
    assert_eq!(undone.revision, 2);
    assert!(matches!(&undone.patches[0], TmDocPatch::StateRemoved { .. }));
    assert_eq!(tm::snapshot(&session, SEEDED_TAB_ID).unwrap().states.len(), 0);

    let redone = tm::redo(&session, SEEDED_TAB_ID).unwrap().expect("there is a transaction to redo");
    assert_eq!(redone.revision, 3);
    assert_eq!(tm::snapshot(&session, SEEDED_TAB_ID).unwrap().states.len(), 1);
}

#[test]
fn undo_on_a_fresh_session_is_none() {
    let session = TmSession::new();
    assert!(tm::undo(&session, SEEDED_TAB_ID).unwrap().is_none());
}

#[test]
fn save_then_open_round_trips_the_document() {
    let session = TmSession::new();
    tm::apply(&session, SEEDED_TAB_ID, ops(&[TmEditOpDto::AddState { label: "q0".into(), x: 3.0, y: 4.0 }])).unwrap();
    let path = std::env::temp_dir().join(format!("tm-ipc-test-{}.json", std::process::id()));
    let path_str = path.to_str().unwrap().to_string();

    tm::save(&session, SEEDED_TAB_ID, path_str.clone()).unwrap();

    let fresh_session = TmSession::new();
    let loaded = tm::open(&fresh_session, SEEDED_TAB_ID, path_str).unwrap();
    std::fs::remove_file(&path).ok();

    assert_eq!(loaded.states.len(), 1);
    assert_eq!(loaded.states[0].label, "q0");
    assert_eq!((loaded.states[0].x, loaded.states[0].y), (3.0, 4.0));
}

#[test]
fn two_tape_transition_is_addable_and_tape_count_shows_up_in_derived() {
    let session = TmSession::new();
    tm::apply(
        &session,
        SEEDED_TAB_ID,
        ops(&[
            TmEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            TmEditOpDto::AddState { label: "q1".into(), x: 10.0, y: 0.0 },
        ]),
    )
    .unwrap();
    let q0 = tm::snapshot(&session, SEEDED_TAB_ID).unwrap().states.iter().find(|s| s.label == "q0").unwrap().id;
    let q1 = tm::snapshot(&session, SEEDED_TAB_ID).unwrap().states.iter().find(|s| s.label == "q1").unwrap().id;

    let r = tm::apply(
        &session,
        SEEDED_TAB_ID,
        ops(&[TmEditOpDto::AddTransition {
            from: q0,
            to: q1,
            tapes: vec![tape_op("a", "a", "R"), tape_op("b", "b", "L")],
        }]),
    )
    .unwrap();

    assert_eq!(r.derived.tape_count, 2);
    let snap = tm::snapshot(&session, SEEDED_TAB_ID).unwrap();
    assert_eq!(snap.transitions.len(), 1);
    assert_eq!(snap.transitions[0].tapes.len(), 2);

    // A mismatched-tape-count AddTransition is silently rejected exactly
    // like the core layer does: no patches, and the revision still bumps
    // for the no-op transaction (matching `TmDocument::apply`'s documented
    // behavior), but no new transition appears.
    let before_revision = tm::snapshot(&session, SEEDED_TAB_ID).unwrap().revision;
    let rejected = tm::apply(
        &session,
        SEEDED_TAB_ID,
        ops(&[TmEditOpDto::AddTransition { from: q0, to: q1, tapes: vec![tape_op("c", "c", "S")] }]),
    )
    .unwrap();
    assert!(rejected.patches.is_empty(), "wrong tape count must produce no patches");
    assert_eq!(rejected.revision, before_revision + 1);
    assert_eq!(tm::snapshot(&session, SEEDED_TAB_ID).unwrap().transitions.len(), 1, "the rejected transition must not appear");
}

#[test]
fn sim_respects_accept_by_and_defaults_to_final_state() {
    // Unary-increment TM (mirrors engine::tm's own `unary_increment` fixture):
    // scan right over 1s, then on blank write one more 1 and move to `done`.
    let session = TmSession::new();
    tm::apply(
        &session,
        SEEDED_TAB_ID,
        ops(&[
            TmEditOpDto::AddState { label: "scan".into(), x: 0.0, y: 0.0 },
            TmEditOpDto::AddState { label: "done".into(), x: 10.0, y: 0.0 },
        ]),
    )
    .unwrap();
    let scan = tm::snapshot(&session, SEEDED_TAB_ID).unwrap().states.iter().find(|s| s.label == "scan").unwrap().id;
    let done = tm::snapshot(&session, SEEDED_TAB_ID).unwrap().states.iter().find(|s| s.label == "done").unwrap().id;
    tm::apply(
        &session,
        SEEDED_TAB_ID,
        ops(&[
            TmEditOpDto::SetInitial { id: Some(scan) },
            TmEditOpDto::SetAccepting { id: done, accepting: true },
            TmEditOpDto::AddTransition { from: scan, to: scan, tapes: vec![tape_op("1", "1", "R")] },
            TmEditOpDto::AddTransition { from: scan, to: done, tapes: vec![tape_op("\u{25a1}", "1", "R")] },
        ]),
    )
    .unwrap();

    let final_trace =
        tm::sim(&session, SEEDED_TAB_ID, vec![vec!["1".to_string(), "1".to_string(), "1".to_string()]], None, None).unwrap();
    assert_eq!(final_trace.outcome, "Accepted");
    let last = final_trace.steps.last().unwrap();
    let cfg = &last[0];
    assert_eq!(cfg.tapes[0].cells.len(), 4, "should have written a 4th '1'");

    let halting_trace = tm::sim(
        &session,
        SEEDED_TAB_ID,
        vec![vec!["1".to_string(), "1".to_string()]],
        Some(tm::AcceptByDto::Halting),
        None,
    )
    .unwrap();
    assert_eq!(halting_trace.outcome, "Accepted");
}

#[test]
fn sim_distinguishes_halting_from_final_state_when_the_machine_halts_outside_an_accepting_state() {
    let session = TmSession::new();
    tm::apply(&session, SEEDED_TAB_ID, ops(&[TmEditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }])).unwrap();
    let q0 = tm::snapshot(&session, SEEDED_TAB_ID).unwrap().states.iter().find(|s| s.label == "q0").unwrap().id;
    tm::apply(
        &session,
        SEEDED_TAB_ID,
        ops(&[
            TmEditOpDto::SetInitial { id: Some(q0) },
            TmEditOpDto::AddTransition { from: q0, to: q0, tapes: vec![tape_op("1", "1", "R")] },
        ]),
    )
    .unwrap();

    let halting =
        tm::sim(&session, SEEDED_TAB_ID, vec![vec!["1".to_string(), "1".to_string()]], Some(tm::AcceptByDto::Halting), None)
            .unwrap();
    assert_eq!(halting.outcome, "Accepted");

    let final_state =
        tm::sim(&session, SEEDED_TAB_ID, vec![vec!["1".to_string(), "1".to_string()]], Some(tm::AcceptByDto::Final), None)
            .unwrap();
    assert_eq!(final_state.outcome, "Rejected");
}
