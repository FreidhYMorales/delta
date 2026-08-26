//! `mealy_snapshot` / `mealy_apply` / `mealy_undo` / `mealy_redo` /
//! `mealy_open` / `mealy_save` / `mealy_sim` — same IPC table shape as
//! `commands::doc`/`commands::sim`, addressing `MealySession` instead of
//! `Session` (see `state.rs`'s doc comment: a genuinely separate piece of
//! managed state, not a variant of the FA one).

use std::fs;

use serde::Serialize;

use automata_core::dto;
use automata_core::engine::mealy::{run_mealy, MealyOutcome};
use automata_core::mealy_doc::{MealyDocument, MealyEditOp, MealyHistory};

use crate::mealy_ipc::{diff_patches, snapshot_of, MealyDocSnapshot, MealyEditOpDto, MealyEditResult};
use crate::state::MealySession;
use crate::tabs::TabId;

pub fn snapshot(session: &MealySession, tab: TabId) -> Result<MealyDocSnapshot, String> {
    session.try_with(tab, snapshot_of)
}

pub fn apply(session: &MealySession, tab: TabId, ops: Vec<MealyEditOpDto>) -> Result<MealyEditResult, String> {
    session.try_with_mut(tab, |doc| {
        let before = doc.model.clone();
        let core_ops: Vec<MealyEditOp> = ops.into_iter().map(MealyEditOpDto::into_core).collect();
        doc.apply(core_ops);
        let patches = diff_patches(&before, &doc.model);
        MealyEditResult { revision: doc.revision, patches, derived: crate::mealy_ipc::derived_of(&doc.model) }
    })
}

pub fn undo(session: &MealySession, tab: TabId) -> Result<Option<MealyEditResult>, String> {
    session.try_with_mut(tab, |doc| {
        let before = doc.model.clone();
        if !doc.undo() {
            return None;
        }
        let patches = diff_patches(&before, &doc.model);
        Some(MealyEditResult { revision: doc.revision, patches, derived: crate::mealy_ipc::derived_of(&doc.model) })
    })
}

pub fn redo(session: &MealySession, tab: TabId) -> Result<Option<MealyEditResult>, String> {
    session.try_with_mut(tab, |doc| {
        let before = doc.model.clone();
        if !doc.redo() {
            return None;
        }
        let patches = diff_patches(&before, &doc.model);
        Some(MealyEditResult { revision: doc.revision, patches, derived: crate::mealy_ipc::derived_of(&doc.model) })
    })
}

/// Native JSON only — same scope note as `automata-cli`'s `load_mealy_doc`:
/// no `.jff` for Mealy machines yet.
pub fn open(session: &MealySession, tab: TabId, path: String) -> Result<MealyDocSnapshot, String> {
    let text = fs::read_to_string(&path).map_err(|e| format!("failed to read {path}: {e}"))?;
    let model = dto::mealy_load_from_str(&text).map_err(|e| e.to_string())?;
    session.try_with_mut(tab, |doc| {
        let next_revision = doc.revision + 1;
        *doc = MealyDocument { model, history: MealyHistory::new(200), revision: next_revision };
        snapshot_of(doc)
    })
}

pub fn save(session: &MealySession, tab: TabId, path: String) -> Result<(), String> {
    let json = session.try_with(tab, |doc| dto::mealy_save_to_string(&doc.model))?.map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("failed to write {path}: {e}"))
}

/// Wire-facing mirror of `MealyOutcome` — same "core type stays serde-free,
/// the Tauri layer owns the DTO" split as `commands::sim::TraceDto`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "outcome")]
pub enum MealySimDto {
    Completed { outputs: Vec<String> },
    NoInitialState,
    NoTransition { at: usize },
    Ambiguous { at: usize },
}

impl From<MealyOutcome> for MealySimDto {
    fn from(outcome: MealyOutcome) -> Self {
        match outcome {
            MealyOutcome::Completed(outputs) => MealySimDto::Completed { outputs },
            MealyOutcome::NoInitialState => MealySimDto::NoInitialState,
            MealyOutcome::NoTransition { at } => MealySimDto::NoTransition { at },
            MealyOutcome::Ambiguous { at } => MealySimDto::Ambiguous { at },
        }
    }
}

pub fn sim(session: &MealySession, tab: TabId, input: Vec<String>) -> Result<MealySimDto, String> {
    session.try_with(tab, |doc| {
        let symbols: Vec<&str> = input.iter().map(String::as_str).collect();
        run_mealy(&doc.model, &symbols).into()
    })
}

/// `tab_id` is a required `TabId` (PR11 cutover): every command wrapper
/// addresses exactly the tab the frontend names, with no default — every
/// caller must send an explicit `tab_id` now that the frontend mounts one
/// client per open tab.
#[tauri::command]
pub fn mealy_snapshot(session: tauri::State<'_, MealySession>, tab_id: TabId) -> Result<MealyDocSnapshot, String> {
    snapshot(&session, tab_id)
}

#[tauri::command]
pub fn mealy_apply(
    session: tauri::State<'_, MealySession>,
    tab_id: TabId,
    ops: Vec<MealyEditOpDto>,
) -> Result<MealyEditResult, String> {
    apply(&session, tab_id, ops)
}

#[tauri::command]
pub fn mealy_undo(session: tauri::State<'_, MealySession>, tab_id: TabId) -> Result<Option<MealyEditResult>, String> {
    undo(&session, tab_id)
}

#[tauri::command]
pub fn mealy_redo(session: tauri::State<'_, MealySession>, tab_id: TabId) -> Result<Option<MealyEditResult>, String> {
    redo(&session, tab_id)
}

#[tauri::command]
pub fn mealy_open(
    session: tauri::State<'_, MealySession>,
    tab_id: TabId,
    path: String,
) -> Result<MealyDocSnapshot, String> {
    open(&session, tab_id, path)
}

#[tauri::command]
pub fn mealy_save(session: tauri::State<'_, MealySession>, tab_id: TabId, path: String) -> Result<(), String> {
    save(&session, tab_id, path)
}

#[tauri::command]
pub fn mealy_sim(
    session: tauri::State<'_, MealySession>,
    tab_id: TabId,
    input: Vec<String>,
) -> Result<MealySimDto, String> {
    sim(&session, tab_id, input)
}
