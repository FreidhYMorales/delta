//! `pda_snapshot` / `pda_apply` / `pda_undo` / `pda_redo` / `pda_open` /
//! `pda_save` / `pda_sim` — same IPC table shape as `commands::moore`,
//! addressing `PdaSession` instead of `MooreSession` (see `state.rs`'s doc
//! comment). `pda_sim` differs from `moore_sim`: PDA simulation is genuinely
//! nondeterministic (`engine::pda::run_pda` returns a full branching
//! `Trace`, not one deterministic output sequence), and needs an
//! `accept_by` choice (`AcceptMode` is a per-run parameter, never document
//! state — see `model::pda`'s doc comment) plus an optional `Budget` the
//! same way `commands::sim::sim_trace` already exposes one.

use std::fs;

use serde::{Deserialize, Serialize};

use automata_core::dto;
use automata_core::engine::pda::{run_pda, AcceptMode, PdaConfig};
use automata_core::engine::{Budget, Outcome};
use automata_core::model::pda::PdaDoc;
use automata_core::pda_doc::{PdaDocument, PdaEditOp, PdaHistory};

use crate::commands::sim::BudgetDto;
use crate::pda_ipc::{diff_patches, snapshot_of, PdaDocSnapshot, PdaEditOpDto, PdaEditResult};
use crate::state::PdaSession;

pub fn snapshot(session: &PdaSession) -> PdaDocSnapshot {
    let doc = session.0.lock().expect("session mutex poisoned");
    snapshot_of(&doc)
}

pub fn apply(session: &PdaSession, ops: Vec<PdaEditOpDto>) -> Result<PdaEditResult, String> {
    let mut doc = session.0.lock().map_err(|_| "session mutex poisoned".to_string())?;
    let before = doc.model.clone();
    let core_ops: Vec<PdaEditOp> = ops.into_iter().map(PdaEditOpDto::into_core).collect();
    doc.apply(core_ops);
    let patches = diff_patches(&before, &doc.model);
    Ok(PdaEditResult { revision: doc.revision, patches, derived: crate::pda_ipc::derived_of(&doc.model) })
}

pub fn undo(session: &PdaSession) -> Option<PdaEditResult> {
    let mut doc = session.0.lock().expect("session mutex poisoned");
    let before = doc.model.clone();
    if !doc.undo() {
        return None;
    }
    let patches = diff_patches(&before, &doc.model);
    Some(PdaEditResult { revision: doc.revision, patches, derived: crate::pda_ipc::derived_of(&doc.model) })
}

pub fn redo(session: &PdaSession) -> Option<PdaEditResult> {
    let mut doc = session.0.lock().expect("session mutex poisoned");
    let before = doc.model.clone();
    if !doc.redo() {
        return None;
    }
    let patches = diff_patches(&before, &doc.model);
    Some(PdaEditResult { revision: doc.revision, patches, derived: crate::pda_ipc::derived_of(&doc.model) })
}

/// Native JSON only — same scope note as `automata-cli`'s `load_pda_doc`:
/// no `.jff` for PDAs yet.
pub fn open(session: &PdaSession, path: String) -> Result<PdaDocSnapshot, String> {
    let text = fs::read_to_string(&path).map_err(|e| format!("failed to read {path}: {e}"))?;
    let model = dto::pda_load_from_str(&text).map_err(|e| e.to_string())?;
    let mut doc = session.0.lock().map_err(|_| "session mutex poisoned".to_string())?;
    let next_revision = doc.revision + 1;
    *doc = PdaDocument { model, history: PdaHistory::new(200), revision: next_revision };
    Ok(snapshot_of(&doc))
}

pub fn save(session: &PdaSession, path: String) -> Result<(), String> {
    let doc = session.0.lock().map_err(|_| "session mutex poisoned".to_string())?;
    let json = dto::pda_save_to_string(&doc.model).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("failed to write {path}: {e}"))
}

/// Wire-facing mirror of `AcceptMode` — same "core type stays serde-free,
/// the Tauri layer owns the DTO" split as `MooreSimDto`. Named to match
/// `automata-cli`'s own `--accept-by final|empty` flag (`AcceptByArg`) for
/// naming consistency between the CLI and GUI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AcceptByDto {
    Final,
    Empty,
}

impl Default for AcceptByDto {
    fn default() -> Self {
        AcceptByDto::Final
    }
}

impl From<AcceptByDto> for AcceptMode {
    fn from(a: AcceptByDto) -> Self {
        match a {
            AcceptByDto::Final => AcceptMode::FinalState,
            AcceptByDto::Empty => AcceptMode::EmptyStack,
        }
    }
}

/// One live configuration (state + full stack contents, top last) — same
/// shape as `engine::pda::PdaConfig`, just serializable and label-resolved.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PdaConfigView {
    pub state: u32,
    /// Top-to-bottom order (`stack[0]` is the top) — the natural reading
    /// order for a GUI stack display, the reverse of `PdaConfig`'s
    /// last-is-top runtime representation (see `engine::pda`'s doc comment).
    pub stack: Vec<String>,
}

fn config_view(model: &PdaDoc, cfg: &PdaConfig) -> PdaConfigView {
    let (state, stack) = cfg;
    let labels: Vec<String> = stack
        .iter()
        .rev()
        .map(|s| model.stack_symbol_label(*s).map(str::to_string).unwrap_or_else(|| "Z".to_string()))
        .collect();
    PdaConfigView { state: state.0, stack: labels }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PdaTraceDto {
    pub outcome: String,
    pub steps: Vec<Vec<PdaConfigView>>,
}

fn outcome_str(outcome: Outcome) -> &'static str {
    match outcome {
        Outcome::Accepted => "Accepted",
        Outcome::Rejected => "Rejected",
        Outcome::Stuck => "Stuck",
        Outcome::TruncatedSteps => "TruncatedSteps",
        Outcome::TruncatedConfigs => "TruncatedConfigs",
    }
}

pub fn sim(session: &PdaSession, input: Vec<String>, accept_by: Option<AcceptByDto>, budget: Option<BudgetDto>) -> PdaTraceDto {
    let doc = session.0.lock().expect("session mutex poisoned");
    let mode: AcceptMode = accept_by.unwrap_or_default().into();
    let b: Budget = budget.map(Into::into).unwrap_or_default();
    let words: Vec<&str> = input.iter().map(String::as_str).collect();
    let trace = run_pda(&doc.model, &words, mode, b);
    PdaTraceDto {
        outcome: outcome_str(trace.outcome).to_string(),
        steps: trace.steps.into_iter().map(|step| step.configs.iter().map(|cfg| config_view(&doc.model, cfg)).collect()).collect(),
    }
}

#[tauri::command]
pub fn pda_snapshot(session: tauri::State<'_, PdaSession>) -> PdaDocSnapshot {
    snapshot(&session)
}

#[tauri::command]
pub fn pda_apply(session: tauri::State<'_, PdaSession>, ops: Vec<PdaEditOpDto>) -> Result<PdaEditResult, String> {
    apply(&session, ops)
}

#[tauri::command]
pub fn pda_undo(session: tauri::State<'_, PdaSession>) -> Option<PdaEditResult> {
    undo(&session)
}

#[tauri::command]
pub fn pda_redo(session: tauri::State<'_, PdaSession>) -> Option<PdaEditResult> {
    redo(&session)
}

#[tauri::command]
pub fn pda_open(session: tauri::State<'_, PdaSession>, path: String) -> Result<PdaDocSnapshot, String> {
    open(&session, path)
}

#[tauri::command]
pub fn pda_save(session: tauri::State<'_, PdaSession>, path: String) -> Result<(), String> {
    save(&session, path)
}

#[tauri::command]
pub fn pda_sim(
    session: tauri::State<'_, PdaSession>,
    input: Vec<String>,
    accept_by: Option<AcceptByDto>,
    budget: Option<BudgetDto>,
) -> PdaTraceDto {
    sim(&session, input, accept_by, budget)
}
