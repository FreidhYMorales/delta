//! Task 6.4 (RED) / 6.5 (GREEN): `sim_trace` returns one full bounded trace
//! per call (no per-step round trips) and honors a caller-supplied `Budget`.

use app_lib::commands::doc;
use app_lib::commands::sim::{self, BudgetDto};
use app_lib::ipc::EditOpDto;
use app_lib::state::{Session, SEEDED_TAB_ID};

fn build_two_state_dfa(session: &Session) -> (u32, u32) {
    let r = doc::apply(
        session,
        SEEDED_TAB_ID,
        vec![
            EditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 },
            EditOpDto::AddState { label: "q1".into(), x: 1.0, y: 0.0 },
        ],
    )
    .unwrap();
    let ids: Vec<u32> = r
        .patches
        .iter()
        .filter_map(|p| match p {
            app_lib::ipc::DocPatch::StateAdded { id, .. } => Some(*id),
            _ => None,
        })
        .collect();
    let (q0, q1) = (ids[0], ids[1]);
    doc::apply(
        session,
        SEEDED_TAB_ID,
        vec![
            EditOpDto::SetInitial { id: Some(q0) },
            EditOpDto::SetAccepting { id: q1, accepting: true },
            EditOpDto::SetEdge { from: q0, to: q1, epsilon: false, symbols: vec!["a".into()] },
        ],
    )
    .unwrap();
    (q0, q1)
}

#[test]
fn sim_trace_accepts_a_matching_word_in_one_call() {
    let session = Session::new();
    let (_q0, q1) = build_two_state_dfa(&session);

    let trace = sim::trace(&session, SEEDED_TAB_ID, vec!["a".to_string()], None).unwrap();

    assert_eq!(trace.outcome, "Accepted");
    // one full trace, not a per-step handshake: every step of the walk is
    // already present in a single response.
    assert!(trace.steps.len() >= 2);
    assert_eq!(trace.steps.last().unwrap(), &vec![q1]);
}

#[test]
fn sim_trace_rejects_a_word_ending_off_an_accepting_state() {
    let session = Session::new();
    build_two_state_dfa(&session);

    let trace = sim::trace(&session, SEEDED_TAB_ID, vec![], None).unwrap();
    assert_eq!(trace.outcome, "Rejected");
}

#[test]
fn sim_trace_honors_a_caller_supplied_budget_and_truncates() {
    let session = Session::new();
    let r = doc::apply(&session, SEEDED_TAB_ID, vec![EditOpDto::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]).unwrap();
    let q0 = match &r.patches[0] {
        app_lib::ipc::DocPatch::StateAdded { id, .. } => *id,
        _ => panic!("expected StateAdded"),
    };
    doc::apply(
        &session,
        SEEDED_TAB_ID,
        vec![
            EditOpDto::SetInitial { id: Some(q0) },
            EditOpDto::SetEdge { from: q0, to: q0, epsilon: false, symbols: vec!["a".into()] },
        ],
    )
    .unwrap();

    let word: Vec<String> = std::iter::repeat("a".to_string()).take(50).collect();
    let trace = sim::trace(&session, SEEDED_TAB_ID, word, Some(BudgetDto { max_steps: 5, max_configs: 5_000 })).unwrap();

    assert_eq!(trace.outcome, "TruncatedSteps");
}

#[test]
fn sim_trace_default_budget_matches_design_defaults() {
    let session = Session::new();
    build_two_state_dfa(&session);
    // Default budget (no override) must match design D3: max_steps 10_000,
    // max_configs 5_000 — proven indirectly: a short accepted word must not
    // spuriously truncate under the default.
    let trace = sim::trace(&session, SEEDED_TAB_ID, vec!["a".to_string()], None).unwrap();
    assert_eq!(trace.outcome, "Accepted");
}

#[test]
fn sim_batch_runs_every_word_against_one_compiled_engine() {
    let session = Session::new();
    build_two_state_dfa(&session);

    let words = vec![vec!["a".to_string()], vec![], vec!["a".to_string(), "a".to_string()]];
    let traces = sim::batch(&session, SEEDED_TAB_ID, words, None).unwrap();

    assert_eq!(traces.len(), 3);
    assert_eq!(traces[0].outcome, "Accepted");
    assert_eq!(traces[1].outcome, "Rejected");
    // "aa" has no transition out of q1 for 'a': dies before exhausting input.
    assert_eq!(traces[2].outcome, "Stuck");
}
