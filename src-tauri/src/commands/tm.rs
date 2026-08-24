//! `tm_snapshot` / `tm_apply` / `tm_undo` / `tm_redo` / `tm_open` / `tm_save`
//! / `tm_sim` — same IPC table shape as `commands::pda`, addressing
//! `TmSession` instead of `PdaSession` (see `state.rs`'s doc comment).
//! `tm_sim` differs from `pda_sim`: `inputs` is a *list of per-tape word
//! lists* (`run_tm`'s broadcast-or-per-tape convention — see
//! `engine::tm::run_tm`'s doc comment) instead of one flat word, and
//! `accept_by` picks between `AcceptMode::{FinalState, Halting}`, not PDA's
//! `{FinalState, EmptyStack}` — a TM has no stack, so there is no
//! empty-stack notion; "halting" (no further move available) is TM's own
//! second acceptance criterion instead.

use std::fs;

use serde::{Deserialize, Serialize};

use automata_core::dto;
use automata_core::engine::tm::{run_tm, AcceptMode, TmConfig};
use automata_core::engine::{Budget, Outcome};
use automata_core::model::tm::TmDoc;
use automata_core::tm_doc::{TmDocument, TmEditOp, TmHistory};

use crate::commands::sim::BudgetDto;
use crate::state::TmSession;
use crate::tm_ipc::{diff_patches, snapshot_of, TmDocSnapshot, TmEditOpDto, TmEditResult};

pub fn snapshot(session: &TmSession) -> TmDocSnapshot {
    let doc = session.0.lock().expect("session mutex poisoned");
    snapshot_of(&doc)
}

pub fn apply(session: &TmSession, ops: Vec<TmEditOpDto>) -> Result<TmEditResult, String> {
    let mut doc = session.0.lock().map_err(|_| "session mutex poisoned".to_string())?;
    let before = doc.model.clone();
    let core_ops: Vec<TmEditOp> = ops.into_iter().map(TmEditOpDto::into_core).collect();
    doc.apply(core_ops);
    let patches = diff_patches(&before, &doc.model);
    Ok(TmEditResult { revision: doc.revision, patches, derived: crate::tm_ipc::derived_of(&doc.model) })
}

pub fn undo(session: &TmSession) -> Option<TmEditResult> {
    let mut doc = session.0.lock().expect("session mutex poisoned");
    let before = doc.model.clone();
    if !doc.undo() {
        return None;
    }
    let patches = diff_patches(&before, &doc.model);
    Some(TmEditResult { revision: doc.revision, patches, derived: crate::tm_ipc::derived_of(&doc.model) })
}

pub fn redo(session: &TmSession) -> Option<TmEditResult> {
    let mut doc = session.0.lock().expect("session mutex poisoned");
    let before = doc.model.clone();
    if !doc.redo() {
        return None;
    }
    let patches = diff_patches(&before, &doc.model);
    Some(TmEditResult { revision: doc.revision, patches, derived: crate::tm_ipc::derived_of(&doc.model) })
}

/// Native JSON only — same scope note as `commands::pda::open`: no `.jff`
/// for Turing Machines yet.
pub fn open(session: &TmSession, path: String) -> Result<TmDocSnapshot, String> {
    let text = fs::read_to_string(&path).map_err(|e| format!("failed to read {path}: {e}"))?;
    let model = dto::tm_load_from_str(&text).map_err(|e| e.to_string())?;
    let mut doc = session.0.lock().map_err(|_| "session mutex poisoned".to_string())?;
    let next_revision = doc.revision + 1;
    *doc = TmDocument { model, history: TmHistory::new(200), revision: next_revision };
    Ok(snapshot_of(&doc))
}

pub fn save(session: &TmSession, path: String) -> Result<(), String> {
    let doc = session.0.lock().map_err(|_| "session mutex poisoned".to_string())?;
    let json = dto::tm_save_to_string(&doc.model).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("failed to write {path}: {e}"))
}

/// Wire-facing mirror of `AcceptMode` — same "core type stays serde-free,
/// the Tauri layer owns the DTO" split as `pda::AcceptByDto`. TM's two modes
/// are final-state vs halting (no empty-stack notion — a TM has no stack).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AcceptByDto {
    Final,
    Halting,
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
            AcceptByDto::Halting => AcceptMode::Halting,
        }
    }
}

/// One tape's live contents (sparse, label-resolved) plus head position —
/// same role as `pda::PdaConfigView`'s `stack` field, just per-tape. Blank
/// cells are never included, since `TapeState.cells` itself is already
/// sparse-by-construction (see `engine::tm`'s doc comment on blank writes
/// removing rather than inserting).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TmTapeView {
    pub cells: std::collections::BTreeMap<i64, String>,
    pub head: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TmConfigView {
    pub state: u32,
    pub tapes: Vec<TmTapeView>,
}

fn config_view(model: &TmDoc, cfg: &TmConfig) -> TmConfigView {
    let (state, tapes) = cfg;
    let tape_views = tapes
        .iter()
        .map(|tape| {
            let cells = tape
                .cells
                .iter()
                .filter_map(|(&pos, &sym)| model.symbol_label(sym).map(|label| (pos, label.to_string())))
                .collect();
            TmTapeView { cells, head: tape.head }
        })
        .collect();
    TmConfigView { state: state.0, tapes: tape_views }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TmTraceDto {
    pub outcome: String,
    pub steps: Vec<Vec<TmConfigView>>,
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
    session: &TmSession,
    inputs: Vec<Vec<String>>,
    accept_by: Option<AcceptByDto>,
    budget: Option<BudgetDto>,
) -> TmTraceDto {
    let doc = session.0.lock().expect("session mutex poisoned");
    let mode: AcceptMode = accept_by.unwrap_or_default().into();
    let b: Budget = budget.map(Into::into).unwrap_or_default();

    // Build the `&[&[&str]]` view `run_tm` expects: an owned `Vec<Vec<&str>>`
    // borrowing from `inputs` first (must outlive the `Vec<&[&str]>` view
    // built from it), then one more level of slicing on top.
    let owned: Vec<Vec<&str>> = inputs.iter().map(|word| word.iter().map(String::as_str).collect()).collect();
    let words: Vec<&[&str]> = owned.iter().map(Vec::as_slice).collect();

    let trace = run_tm(&doc.model, &words, mode, b);
    TmTraceDto {
        outcome: outcome_str(trace.outcome).to_string(),
        steps: trace
            .steps
            .into_iter()
            .map(|step| step.configs.iter().map(|cfg| config_view(&doc.model, cfg)).collect())
            .collect(),
    }
}

#[tauri::command]
pub fn tm_snapshot(session: tauri::State<'_, TmSession>) -> TmDocSnapshot {
    snapshot(&session)
}

#[tauri::command]
pub fn tm_apply(session: tauri::State<'_, TmSession>, ops: Vec<TmEditOpDto>) -> Result<TmEditResult, String> {
    apply(&session, ops)
}

#[tauri::command]
pub fn tm_undo(session: tauri::State<'_, TmSession>) -> Option<TmEditResult> {
    undo(&session)
}

#[tauri::command]
pub fn tm_redo(session: tauri::State<'_, TmSession>) -> Option<TmEditResult> {
    redo(&session)
}

#[tauri::command]
pub fn tm_open(session: tauri::State<'_, TmSession>, path: String) -> Result<TmDocSnapshot, String> {
    open(&session, path)
}

#[tauri::command]
pub fn tm_save(session: tauri::State<'_, TmSession>, path: String) -> Result<(), String> {
    save(&session, path)
}

#[tauri::command]
pub fn tm_sim(
    session: tauri::State<'_, TmSession>,
    inputs: Vec<Vec<String>>,
    accept_by: Option<AcceptByDto>,
    budget: Option<BudgetDto>,
) -> TmTraceDto {
    sim(&session, inputs, accept_by, budget)
}
