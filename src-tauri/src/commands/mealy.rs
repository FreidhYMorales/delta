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

pub fn snapshot(session: &MealySession) -> MealyDocSnapshot {
    let doc = session.0.lock().expect("session mutex poisoned");
    snapshot_of(&doc)
}

pub fn apply(session: &MealySession, ops: Vec<MealyEditOpDto>) -> Result<MealyEditResult, String> {
    let mut doc = session.0.lock().map_err(|_| "session mutex poisoned".to_string())?;
    let before = doc.model.clone();
    let core_ops: Vec<MealyEditOp> = ops.into_iter().map(MealyEditOpDto::into_core).collect();
    doc.apply(core_ops);
    let patches = diff_patches(&before, &doc.model);
    Ok(MealyEditResult { revision: doc.revision, patches, derived: crate::mealy_ipc::derived_of(&doc.model) })
}

pub fn undo(session: &MealySession) -> Option<MealyEditResult> {
    let mut doc = session.0.lock().expect("session mutex poisoned");
    let before = doc.model.clone();
    if !doc.undo() {
        return None;
    }
    let patches = diff_patches(&before, &doc.model);
    Some(MealyEditResult { revision: doc.revision, patches, derived: crate::mealy_ipc::derived_of(&doc.model) })
}

pub fn redo(session: &MealySession) -> Option<MealyEditResult> {
    let mut doc = session.0.lock().expect("session mutex poisoned");
    let before = doc.model.clone();
    if !doc.redo() {
        return None;
    }
    let patches = diff_patches(&before, &doc.model);
    Some(MealyEditResult { revision: doc.revision, patches, derived: crate::mealy_ipc::derived_of(&doc.model) })
}

/// Native JSON only — same scope note as `automata-cli`'s `load_mealy_doc`:
/// no `.jff` for Mealy machines yet.
pub fn open(session: &MealySession, path: String) -> Result<MealyDocSnapshot, String> {
    let text = fs::read_to_string(&path).map_err(|e| format!("failed to read {path}: {e}"))?;
    let model = dto::mealy_load_from_str(&text).map_err(|e| e.to_string())?;
    let mut doc = session.0.lock().map_err(|_| "session mutex poisoned".to_string())?;
    let next_revision = doc.revision + 1;
    *doc = MealyDocument { model, history: MealyHistory::new(200), revision: next_revision };
    Ok(snapshot_of(&doc))
}

pub fn save(session: &MealySession, path: String) -> Result<(), String> {
    let doc = session.0.lock().map_err(|_| "session mutex poisoned".to_string())?;
    let json = dto::mealy_save_to_string(&doc.model).map_err(|e| e.to_string())?;
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

pub fn sim(session: &MealySession, input: Vec<String>) -> MealySimDto {
    let doc = session.0.lock().expect("session mutex poisoned");
    let symbols: Vec<&str> = input.iter().map(String::as_str).collect();
    run_mealy(&doc.model, &symbols).into()
}

#[tauri::command]
pub fn mealy_snapshot(session: tauri::State<'_, MealySession>) -> MealyDocSnapshot {
    snapshot(&session)
}

#[tauri::command]
pub fn mealy_apply(session: tauri::State<'_, MealySession>, ops: Vec<MealyEditOpDto>) -> Result<MealyEditResult, String> {
    apply(&session, ops)
}

#[tauri::command]
pub fn mealy_undo(session: tauri::State<'_, MealySession>) -> Option<MealyEditResult> {
    undo(&session)
}

#[tauri::command]
pub fn mealy_redo(session: tauri::State<'_, MealySession>) -> Option<MealyEditResult> {
    redo(&session)
}

#[tauri::command]
pub fn mealy_open(session: tauri::State<'_, MealySession>, path: String) -> Result<MealyDocSnapshot, String> {
    open(&session, path)
}

#[tauri::command]
pub fn mealy_save(session: tauri::State<'_, MealySession>, path: String) -> Result<(), String> {
    save(&session, path)
}

#[tauri::command]
pub fn mealy_sim(session: tauri::State<'_, MealySession>, input: Vec<String>) -> MealySimDto {
    sim(&session, input)
}
