//! `moore_snapshot` / `moore_apply` / `moore_undo` / `moore_redo` /
//! `moore_open` / `moore_save` / `moore_sim` — same IPC table shape as
//! `commands::mealy`, addressing `MooreSession` instead of `MealySession`/
//! `Session` (see `state.rs`'s doc comment: a genuinely separate piece of
//! managed state, not a variant of either).

use std::fs;

use serde::Serialize;

use automata_core::dto;
use automata_core::engine::moore::{run_moore, MooreOutcome};
use automata_core::moore_doc::{MooreDocument, MooreEditOp, MooreHistory};

use crate::moore_ipc::{diff_patches, snapshot_of, MooreDocSnapshot, MooreEditOpDto, MooreEditResult};
use crate::state::MooreSession;

pub fn snapshot(session: &MooreSession) -> MooreDocSnapshot {
    let doc = session.0.lock().expect("session mutex poisoned");
    snapshot_of(&doc)
}

pub fn apply(session: &MooreSession, ops: Vec<MooreEditOpDto>) -> Result<MooreEditResult, String> {
    let mut doc = session.0.lock().map_err(|_| "session mutex poisoned".to_string())?;
    let before = doc.model.clone();
    let core_ops: Vec<MooreEditOp> = ops.into_iter().map(MooreEditOpDto::into_core).collect();
    doc.apply(core_ops);
    let patches = diff_patches(&before, &doc.model);
    Ok(MooreEditResult { revision: doc.revision, patches, derived: crate::moore_ipc::derived_of(&doc.model) })
}

pub fn undo(session: &MooreSession) -> Option<MooreEditResult> {
    let mut doc = session.0.lock().expect("session mutex poisoned");
    let before = doc.model.clone();
    if !doc.undo() {
        return None;
    }
    let patches = diff_patches(&before, &doc.model);
    Some(MooreEditResult { revision: doc.revision, patches, derived: crate::moore_ipc::derived_of(&doc.model) })
}

pub fn redo(session: &MooreSession) -> Option<MooreEditResult> {
    let mut doc = session.0.lock().expect("session mutex poisoned");
    let before = doc.model.clone();
    if !doc.redo() {
        return None;
    }
    let patches = diff_patches(&before, &doc.model);
    Some(MooreEditResult { revision: doc.revision, patches, derived: crate::moore_ipc::derived_of(&doc.model) })
}

/// Native JSON only — same scope note as `automata-cli`'s `load_moore_doc`:
/// no `.jff` for Moore machines yet.
pub fn open(session: &MooreSession, path: String) -> Result<MooreDocSnapshot, String> {
    let text = fs::read_to_string(&path).map_err(|e| format!("failed to read {path}: {e}"))?;
    let model = dto::moore_load_from_str(&text).map_err(|e| e.to_string())?;
    let mut doc = session.0.lock().map_err(|_| "session mutex poisoned".to_string())?;
    let next_revision = doc.revision + 1;
    *doc = MooreDocument { model, history: MooreHistory::new(200), revision: next_revision };
    Ok(snapshot_of(&doc))
}

pub fn save(session: &MooreSession, path: String) -> Result<(), String> {
    let doc = session.0.lock().map_err(|_| "session mutex poisoned".to_string())?;
    let json = dto::moore_save_to_string(&doc.model).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("failed to write {path}: {e}"))
}

/// Wire-facing mirror of `MooreOutcome` — same "core type stays serde-free,
/// the Tauri layer owns the DTO" split as `commands::mealy::MealySimDto`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "outcome")]
pub enum MooreSimDto {
    Completed { outputs: Vec<String> },
    NoInitialState,
    NoTransition { at: usize },
    Ambiguous { at: usize },
}

impl From<MooreOutcome> for MooreSimDto {
    fn from(outcome: MooreOutcome) -> Self {
        match outcome {
            MooreOutcome::Completed(outputs) => MooreSimDto::Completed { outputs },
            MooreOutcome::NoInitialState => MooreSimDto::NoInitialState,
            MooreOutcome::NoTransition { at } => MooreSimDto::NoTransition { at },
            MooreOutcome::Ambiguous { at } => MooreSimDto::Ambiguous { at },
        }
    }
}

pub fn sim(session: &MooreSession, input: Vec<String>) -> MooreSimDto {
    let doc = session.0.lock().expect("session mutex poisoned");
    let symbols: Vec<&str> = input.iter().map(String::as_str).collect();
    run_moore(&doc.model, &symbols).into()
}

#[tauri::command]
pub fn moore_snapshot(session: tauri::State<'_, MooreSession>) -> MooreDocSnapshot {
    snapshot(&session)
}

#[tauri::command]
pub fn moore_apply(session: tauri::State<'_, MooreSession>, ops: Vec<MooreEditOpDto>) -> Result<MooreEditResult, String> {
    apply(&session, ops)
}

#[tauri::command]
pub fn moore_undo(session: tauri::State<'_, MooreSession>) -> Option<MooreEditResult> {
    undo(&session)
}

#[tauri::command]
pub fn moore_redo(session: tauri::State<'_, MooreSession>) -> Option<MooreEditResult> {
    redo(&session)
}

#[tauri::command]
pub fn moore_open(session: tauri::State<'_, MooreSession>, path: String) -> Result<MooreDocSnapshot, String> {
    open(&session, path)
}

#[tauri::command]
pub fn moore_save(session: tauri::State<'_, MooreSession>, path: String) -> Result<(), String> {
    save(&session, path)
}

#[tauri::command]
pub fn moore_sim(session: tauri::State<'_, MooreSession>, input: Vec<String>) -> MooreSimDto {
    sim(&session, input)
}
