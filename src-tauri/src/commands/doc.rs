//! `doc_snapshot` / `doc_apply` / `doc_undo` / `doc_redo` / `doc_open` /
//! `doc_save` (design D3 IPC table). Mutation commands return `EditResult`
//! carrying only the diff since the previous state (`ipc::diff_patches`);
//! `doc_snapshot` is the full-state path used on open/import or resync.

use std::fs;

use automata_core::doc::{Document, EditOp, History};
use automata_core::dto;

use crate::ipc::{derived_of, diff_patches, snapshot_of, DocSnapshot, EditOpDto, EditResult};
use crate::state::Session;
use crate::tabs::TabId;

pub fn snapshot(session: &Session, tab: TabId) -> Result<DocSnapshot, String> {
    session.try_with(tab, snapshot_of)
}

pub fn apply(session: &Session, tab: TabId, ops: Vec<EditOpDto>) -> Result<EditResult, String> {
    session.try_with_mut(tab, |doc| {
        let before = doc.model.clone();
        let core_ops: Vec<EditOp> = ops.into_iter().map(EditOpDto::into_core).collect();
        doc.apply(core_ops);
        let patches = diff_patches(&before, &doc.model);
        EditResult { revision: doc.revision, patches, derived: derived_of(&doc.model) }
    })
}

pub fn undo(session: &Session, tab: TabId) -> Result<Option<EditResult>, String> {
    session.try_with_mut(tab, |doc| {
        let before = doc.model.clone();
        if !doc.undo() {
            return None;
        }
        let patches = diff_patches(&before, &doc.model);
        Some(EditResult { revision: doc.revision, patches, derived: derived_of(&doc.model) })
    })
}

pub fn redo(session: &Session, tab: TabId) -> Result<Option<EditResult>, String> {
    session.try_with_mut(tab, |doc| {
        let before = doc.model.clone();
        if !doc.redo() {
            return None;
        }
        let patches = diff_patches(&before, &doc.model);
        Some(EditResult { revision: doc.revision, patches, derived: derived_of(&doc.model) })
    })
}

/// Load a native JSON document from `path`, replacing the session's current
/// document entirely (fresh undo history — an opened file has no prior
/// edits to undo). Emits `doc://replaced` on the frontend per design D3;
/// this command only returns the new full snapshot, the event itself is a
/// frontend/Tauri-emit concern out of this PR's scope (Phase 7).
pub fn open(session: &Session, tab: TabId, path: String) -> Result<DocSnapshot, String> {
    let text = fs::read_to_string(&path).map_err(|e| format!("failed to read {path}: {e}"))?;
    let model = dto::load_from_str(&text).map_err(|e| e.to_string())?;
    session.try_with_mut(tab, |doc| {
        let next_revision = doc.revision + 1;
        *doc = Document { model, history: History::new(200), revision: next_revision };
        snapshot_of(doc)
    })
}

pub fn save(session: &Session, tab: TabId, path: String) -> Result<(), String> {
    let json = session.try_with(tab, |doc| dto::save_to_string(&doc.model))?.map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("failed to write {path}: {e}"))
}

/// `tab_id` is a required `TabId` (PR11 cutover): every command wrapper
/// addresses exactly the tab the frontend names, with no default — every
/// caller must send an explicit `tab_id` now that the frontend mounts one
/// client per open tab.
#[tauri::command]
pub fn doc_snapshot(session: tauri::State<'_, Session>, tab_id: TabId) -> Result<DocSnapshot, String> {
    snapshot(&session, tab_id)
}

#[tauri::command]
pub fn doc_apply(
    session: tauri::State<'_, Session>,
    tab_id: TabId,
    ops: Vec<EditOpDto>,
) -> Result<EditResult, String> {
    apply(&session, tab_id, ops)
}

#[tauri::command]
pub fn doc_undo(session: tauri::State<'_, Session>, tab_id: TabId) -> Result<Option<EditResult>, String> {
    undo(&session, tab_id)
}

#[tauri::command]
pub fn doc_redo(session: tauri::State<'_, Session>, tab_id: TabId) -> Result<Option<EditResult>, String> {
    redo(&session, tab_id)
}

#[tauri::command]
pub fn doc_open(
    session: tauri::State<'_, Session>,
    tab_id: TabId,
    path: String,
) -> Result<DocSnapshot, String> {
    open(&session, tab_id, path)
}

#[tauri::command]
pub fn doc_save(session: tauri::State<'_, Session>, tab_id: TabId, path: String) -> Result<(), String> {
    save(&session, tab_id, path)
}
