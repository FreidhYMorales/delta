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
use crate::tabs::TabId;

pub fn snapshot(session: &PdaSession, tab: TabId) -> Result<PdaDocSnapshot, String> {
    session.try_with(tab, snapshot_of)
}

pub fn apply(session: &PdaSession, tab: TabId, ops: Vec<PdaEditOpDto>) -> Result<PdaEditResult, String> {
    session.try_with_mut(tab, |doc| {
        let before = doc.model.clone();
        let core_ops: Vec<PdaEditOp> = ops.into_iter().map(PdaEditOpDto::into_core).collect();
        doc.apply(core_ops);
        let patches = diff_patches(&before, &doc.model);
        PdaEditResult { revision: doc.revision, patches, derived: crate::pda_ipc::derived_of(&doc.model) }
    })
}

pub fn undo(session: &PdaSession, tab: TabId) -> Result<Option<PdaEditResult>, String> {
    session.try_with_mut(tab, |doc| {
        let before = doc.model.clone();
        if !doc.undo() {
            return None;
        }
        let patches = diff_patches(&before, &doc.model);
        Some(PdaEditResult { revision: doc.revision, patches, derived: crate::pda_ipc::derived_of(&doc.model) })
    })
}

pub fn redo(session: &PdaSession, tab: TabId) -> Result<Option<PdaEditResult>, String> {
    session.try_with_mut(tab, |doc| {
        let before = doc.model.clone();
        if !doc.redo() {
            return None;
        }
        let patches = diff_patches(&before, &doc.model);
        Some(PdaEditResult { revision: doc.revision, patches, derived: crate::pda_ipc::derived_of(&doc.model) })
    })
}

/// Native JSON only — same scope note as `automata-cli`'s `load_pda_doc`:
/// no `.jff` for PDAs yet.
pub fn open(session: &PdaSession, tab: TabId, path: String) -> Result<PdaDocSnapshot, String> {
    let text = fs::read_to_string(&path).map_err(|e| format!("failed to read {path}: {e}"))?;
    let model = dto::pda_load_from_str(&text).map_err(|e| e.to_string())?;
    session.try_with_mut(tab, |doc| {
        let next_revision = doc.revision + 1;
        *doc = PdaDocument { model, history: PdaHistory::new(200), revision: next_revision };
        snapshot_of(doc)
    })
}

pub fn save(session: &PdaSession, tab: TabId, path: String) -> Result<(), String> {
    let json = session.try_with(tab, |doc| dto::pda_save_to_string(&doc.model))?.map_err(|e| e.to_string())?;
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

pub fn sim(
    session: &PdaSession,
    tab: TabId,
    input: Vec<String>,
    accept_by: Option<AcceptByDto>,
    budget: Option<BudgetDto>,
) -> Result<PdaTraceDto, String> {
    session.try_with(tab, |doc| {
        let mode: AcceptMode = accept_by.unwrap_or_default().into();
        let b: Budget = budget.map(Into::into).unwrap_or_default();
        let words: Vec<&str> = input.iter().map(String::as_str).collect();
        let trace = run_pda(&doc.model, &words, mode, b);
        PdaTraceDto {
            outcome: outcome_str(trace.outcome).to_string(),
            steps: trace.steps.into_iter().map(|step| step.configs.iter().map(|cfg| config_view(&doc.model, cfg)).collect()).collect(),
        }
    })
}

/// `tab_id` is a required `TabId` (PR11 cutover): every command wrapper
/// addresses exactly the tab the frontend names, with no default — every
/// caller must send an explicit `tab_id` now that the frontend mounts one
/// client per open tab.
#[tauri::command]
pub fn pda_snapshot(session: tauri::State<'_, PdaSession>, tab_id: TabId) -> Result<PdaDocSnapshot, String> {
    snapshot(&session, tab_id)
}

#[tauri::command]
pub fn pda_apply(
    session: tauri::State<'_, PdaSession>,
    tab_id: TabId,
    ops: Vec<PdaEditOpDto>,
) -> Result<PdaEditResult, String> {
    apply(&session, tab_id, ops)
}

#[tauri::command]
pub fn pda_undo(session: tauri::State<'_, PdaSession>, tab_id: TabId) -> Result<Option<PdaEditResult>, String> {
    undo(&session, tab_id)
}

#[tauri::command]
pub fn pda_redo(session: tauri::State<'_, PdaSession>, tab_id: TabId) -> Result<Option<PdaEditResult>, String> {
    redo(&session, tab_id)
}

#[tauri::command]
pub fn pda_open(
    session: tauri::State<'_, PdaSession>,
    tab_id: TabId,
    path: String,
) -> Result<PdaDocSnapshot, String> {
    open(&session, tab_id, path)
}

#[tauri::command]
pub fn pda_save(session: tauri::State<'_, PdaSession>, tab_id: TabId, path: String) -> Result<(), String> {
    save(&session, tab_id, path)
}

#[tauri::command]
pub fn pda_sim(
    session: tauri::State<'_, PdaSession>,
    tab_id: TabId,
    input: Vec<String>,
    accept_by: Option<AcceptByDto>,
    budget: Option<BudgetDto>,
) -> Result<PdaTraceDto, String> {
    sim(&session, tab_id, input, accept_by, budget)
}
