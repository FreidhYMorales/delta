//! `doc_snapshot` / `doc_apply` / `doc_undo` / `doc_redo` / `doc_open` /
//! `doc_save` (design D3 IPC table). Mutation commands return `EditResult`
//! carrying only the diff since the previous state (`ipc::diff_patches`);
//! `doc_snapshot` is the full-state path used on open/import or resync.

use std::fs;

use automata_core::doc::{Document, EditOp, History};
use automata_core::dto;

use crate::ipc::{derived_of, diff_patches, snapshot_of, DocSnapshot, EditOpDto, EditResult};
use crate::state::Session;

pub fn snapshot(session: &Session) -> DocSnapshot {
    let doc = session.0.lock().expect("session mutex poisoned");
    snapshot_of(&doc)
}

pub fn apply(session: &Session, ops: Vec<EditOpDto>) -> Result<EditResult, String> {
    let mut doc = session.0.lock().map_err(|_| "session mutex poisoned".to_string())?;
    let before = doc.model.clone();
    let core_ops: Vec<EditOp> = ops.into_iter().map(EditOpDto::into_core).collect();
    doc.apply(core_ops);
    let patches = diff_patches(&before, &doc.model);
    Ok(EditResult { revision: doc.revision, patches, derived: derived_of(&doc.model) })
}

pub fn undo(session: &Session) -> Option<EditResult> {
    let mut doc = session.0.lock().expect("session mutex poisoned");
    let before = doc.model.clone();
    if !doc.undo() {
        return None;
    }
    let patches = diff_patches(&before, &doc.model);
    Some(EditResult { revision: doc.revision, patches, derived: derived_of(&doc.model) })
}

pub fn redo(session: &Session) -> Option<EditResult> {
    let mut doc = session.0.lock().expect("session mutex poisoned");
    let before = doc.model.clone();
    if !doc.redo() {
        return None;
    }
    let patches = diff_patches(&before, &doc.model);
    Some(EditResult { revision: doc.revision, patches, derived: derived_of(&doc.model) })
}

/// Load a native JSON document from `path`, replacing the session's current
/// document entirely (fresh undo history — an opened file has no prior
/// edits to undo). Emits `doc://replaced` on the frontend per design D3;
/// this command only returns the new full snapshot, the event itself is a
/// frontend/Tauri-emit concern out of this PR's scope (Phase 7).
pub fn open(session: &Session, path: String) -> Result<DocSnapshot, String> {
    let text = fs::read_to_string(&path).map_err(|e| format!("failed to read {path}: {e}"))?;
    let model = dto::load_from_str(&text).map_err(|e| e.to_string())?;
    let mut doc = session.0.lock().map_err(|_| "session mutex poisoned".to_string())?;
    let next_revision = doc.revision + 1;
    *doc = Document { model, history: History::new(200), revision: next_revision };
    Ok(snapshot_of(&doc))
}

pub fn save(session: &Session, path: String) -> Result<(), String> {
    let doc = session.0.lock().map_err(|_| "session mutex poisoned".to_string())?;
    let json = dto::save_to_string(&doc.model).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("failed to write {path}: {e}"))
}

#[tauri::command]
pub fn doc_snapshot(session: tauri::State<'_, Session>) -> DocSnapshot {
    snapshot(&session)
}

#[tauri::command]
pub fn doc_apply(session: tauri::State<'_, Session>, ops: Vec<EditOpDto>) -> Result<EditResult, String> {
    apply(&session, ops)
}

#[tauri::command]
pub fn doc_undo(session: tauri::State<'_, Session>) -> Option<EditResult> {
    undo(&session)
}

#[tauri::command]
pub fn doc_redo(session: tauri::State<'_, Session>) -> Option<EditResult> {
    redo(&session)
}

#[tauri::command]
pub fn doc_open(session: tauri::State<'_, Session>, path: String) -> Result<DocSnapshot, String> {
    open(&session, path)
}

#[tauri::command]
pub fn doc_save(session: tauri::State<'_, Session>, path: String) -> Result<(), String> {
    save(&session, path)
}
