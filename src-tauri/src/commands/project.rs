//! `project_new` / `project_manifest` / `project_new_tab` / `project_close_tab`
//! / `project_rename_tab` / `project_open` / `project_save` (PR3 of the
//! `multi-tab-projects` change, design D14). Same "pure fn + thin
//! `#[tauri::command]` wrapper" split every other command module in this
//! crate already uses (see `commands/doc.rs`), so these are directly
//! testable over real sessions without a mocked Tauri app harness.
//!
//! `ProjectSession` (`tabs.rs`) owns the ordered, kind-tagged tab list and
//! the `TabId` allocator but has no interior mutability of its own — same
//! reason every per-kind `*Session` in `state.rs` wraps its `HashMap` in a
//! `Mutex`, this module wraps `ProjectSession` in one too (`ProjectState`)
//! rather than modifying `tabs.rs`'s own struct.
//!
//! Revision/dirty-tracking (design D10): every per-kind document already
//! carries its own monotonically increasing `revision: u64` counter (bumped
//! on `apply`/`undo`/`redo` — see `doc/mod.rs`, `mealy_doc.rs`,
//! `moore_doc.rs`, `pda_doc.rs`, `tm_doc.rs`). Rather than inventing a
//! parallel project-wide counter, `ProjectManifest::revision` is the sum of
//! every open tab's own `revision` — the frontend already receives each
//! tab's `revision` on every `*_apply`/`*_undo`/`*_redo` response (zero
//! extra IPC to keep its own live aggregate up to date) and treats the
//! `revision` returned by `project_open`/`project_save`/`project_new_tab` as
//! the `savedRevision` baseline to diff its live aggregate against.

use std::fs;
use std::sync::Mutex;

use serde::Serialize;

use automata_core::doc::Document;
use automata_core::dto::{
    fa_from_dto, fa_to_dto, mealy_from_dto, mealy_to_dto, moore_from_dto, moore_to_dto, pda_from_dto, pda_to_dto,
    tm_from_dto, tm_to_dto, MachineDoc,
};
use automata_core::mealy_doc::MealyDocument;
use automata_core::moore_doc::MooreDocument;
use automata_core::pda_doc::PdaDocument;
use automata_core::project::{project_load_from_str, project_save_to_string, ProjectTab};
use automata_core::tm_doc::TmDocument;

use crate::state::{MealySession, MooreSession, PdaSession, Session, TmSession};
use crate::tabs::{MachineKind, ProjectSession, TabId};

/// Tauri-managed wrapper around `ProjectSession` — see this module's doc
/// comment for why the `Mutex` lives here instead of in `tabs.rs`.
pub struct ProjectState(pub Mutex<ProjectSession>);

impl ProjectState {
    pub fn new() -> Self {
        ProjectState(Mutex::new(ProjectSession::new()))
    }
}

impl Default for ProjectState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TabManifestEntry {
    pub id: TabId,
    pub kind: MachineKind,
    pub name: String,
    pub revision: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProjectManifest {
    pub tabs: Vec<TabManifestEntry>,
    pub revision: u64,
}

/// Bundles the 5 per-kind sessions so every pure fn below can take one
/// argument instead of 5 — plain borrows, no new locking behavior.
pub struct Sessions<'a> {
    pub fa: &'a Session,
    pub mealy: &'a MealySession,
    pub moore: &'a MooreSession,
    pub pda: &'a PdaSession,
    pub tm: &'a TmSession,
}

fn manifest_of(project: &ProjectSession, sessions: &Sessions) -> ProjectManifest {
    let mut total_revision: u64 = 0;
    let tabs = project
        .tabs()
        .iter()
        .map(|meta| {
            let revision = match meta.kind {
                MachineKind::Fa => sessions.fa.with(meta.id, |d| d.revision),
                MachineKind::Mealy => sessions.mealy.with(meta.id, |d| d.revision),
                MachineKind::Moore => sessions.moore.with(meta.id, |d| d.revision),
                MachineKind::Pda => sessions.pda.with(meta.id, |d| d.revision),
                MachineKind::Tm => sessions.tm.with(meta.id, |d| d.revision),
            };
            total_revision += revision;
            TabManifestEntry { id: meta.id, kind: meta.kind, name: meta.name.clone(), revision }
        })
        .collect();
    ProjectManifest { tabs, revision: total_revision }
}

fn clear_all_sessions(sessions: &Sessions) {
    sessions.fa.0.lock().expect("session mutex poisoned").clear();
    sessions.mealy.0.lock().expect("session mutex poisoned").clear();
    sessions.moore.0.lock().expect("session mutex poisoned").clear();
    sessions.pda.0.lock().expect("session mutex poisoned").clear();
    sessions.tm.0.lock().expect("session mutex poisoned").clear();
}

/// Resets the project to a fresh, empty state — no tabs. Tab creation is a
/// separate, explicit `project_new_tab` call (app-boot "start with one
/// empty FA tab" behavior is PR11's job, not this command's).
///
/// Uses `ProjectSession::clear_tabs` rather than replacing the whole
/// session with `ProjectSession::new()` — the latter also resets the
/// `TabId` allocator back to 0, which a still-mounted frontend view from
/// the project being replaced would collide with (see `clear_tabs`'s own
/// doc comment).
pub fn new_project(project: &Mutex<ProjectSession>, sessions: &Sessions) -> ProjectManifest {
    let mut guard = project.lock().expect("project session mutex poisoned");
    guard.clear_tabs();
    clear_all_sessions(sessions);
    manifest_of(&guard, sessions)
}

/// Read-only: the current project's ordered tab list plus the live
/// aggregate revision (see this module's doc comment).
pub fn manifest(project: &Mutex<ProjectSession>, sessions: &Sessions) -> ProjectManifest {
    let guard = project.lock().expect("project session mutex poisoned");
    manifest_of(&guard, sessions)
}

fn validate_name<'a>(name: &'a str) -> Result<&'a str, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("tab name must not be empty".to_string());
    }
    Ok(trimmed)
}

/// Allocates a fresh `TabId`, inserts a brand-new empty document of `kind`,
/// and appends a `TabMeta` named `name`. Rejects an empty name or one that
/// duplicates an existing tab's name (exact, case-sensitive match).
pub fn new_tab(
    project: &Mutex<ProjectSession>,
    sessions: &Sessions,
    kind: MachineKind,
    name: String,
) -> Result<ProjectManifest, String> {
    let trimmed = validate_name(&name)?;
    let mut guard = project.lock().expect("project session mutex poisoned");
    if guard.tabs().iter().any(|t| t.name == trimmed) {
        return Err(format!("a tab named \"{trimmed}\" already exists"));
    }
    let id = guard.new_tab(kind, trimmed.to_string());
    match kind {
        MachineKind::Fa => sessions.fa.insert(id, Document::new()),
        MachineKind::Mealy => sessions.mealy.insert(id, MealyDocument::new()),
        MachineKind::Moore => sessions.moore.insert(id, MooreDocument::new()),
        MachineKind::Pda => sessions.pda.insert(id, PdaDocument::new()),
        MachineKind::Tm => sessions.tm.insert(id, TmDocument::new()),
    }
    Ok(manifest_of(&guard, sessions))
}

/// Removes the tab `tab_id` and its document. Closing an unknown or
/// already-removed `tab_id` is an `Err`, not a panic.
pub fn close_tab(project: &Mutex<ProjectSession>, sessions: &Sessions, tab_id: TabId) -> Result<ProjectManifest, String> {
    let mut guard = project.lock().expect("project session mutex poisoned");
    let kind = guard
        .tabs()
        .iter()
        .find(|t| t.id == tab_id)
        .map(|t| t.kind)
        .ok_or_else(|| format!("no tab with id {}", tab_id.0))?;
    guard.remove_tab(tab_id);
    match kind {
        MachineKind::Fa => {
            sessions.fa.remove(tab_id);
        }
        MachineKind::Mealy => {
            sessions.mealy.remove(tab_id);
        }
        MachineKind::Moore => {
            sessions.moore.remove(tab_id);
        }
        MachineKind::Pda => {
            sessions.pda.remove(tab_id);
        }
        MachineKind::Tm => {
            sessions.tm.remove(tab_id);
        }
    }
    Ok(manifest_of(&guard, sessions))
}

/// Renames the tab `tab_id` to `new_name`. Same empty/duplicate-name
/// rejection as `new_tab` (excluding the tab's own current name from the
/// duplicate check). Unknown `tab_id` is an `Err`.
pub fn rename_tab(
    project: &Mutex<ProjectSession>,
    sessions: &Sessions,
    tab_id: TabId,
    new_name: String,
) -> Result<ProjectManifest, String> {
    let trimmed = validate_name(&new_name)?;
    let mut guard = project.lock().expect("project session mutex poisoned");
    if !guard.tabs().iter().any(|t| t.id == tab_id) {
        return Err(format!("no tab with id {}", tab_id.0));
    }
    if guard.tabs().iter().any(|t| t.id != tab_id && t.name == trimmed) {
        return Err(format!("a tab named \"{trimmed}\" already exists"));
    }
    guard.rename_tab(tab_id, trimmed.to_string());
    Ok(manifest_of(&guard, sessions))
}

/// Moves the tab `tab_id` to position `to_index` in the ordered tab list
/// (drag-to-reorder, `ProjectTabStrip`). `to_index` is clamped to the last
/// valid index rather than silently left a no-op like
/// `ProjectSession::reorder` itself is on an out-of-range index — a drop
/// past the last tab is an ordinary "move to the end" gesture, not an
/// error. Unknown `tab_id` is an `Err`, same convention as `rename_tab`/
/// `close_tab`.
pub fn reorder_tab(
    project: &Mutex<ProjectSession>,
    sessions: &Sessions,
    tab_id: TabId,
    to_index: usize,
) -> Result<ProjectManifest, String> {
    let mut guard = project.lock().expect("project session mutex poisoned");
    let from_index = guard
        .tabs()
        .iter()
        .position(|t| t.id == tab_id)
        .ok_or_else(|| format!("no tab with id {}", tab_id.0))?;
    let clamped_to = to_index.min(guard.tabs().len().saturating_sub(1));
    guard.reorder(from_index, clamped_to);
    Ok(manifest_of(&guard, sessions))
}

/// Runtime document of any machine kind, already converted from its
/// on-disk `MachineDoc` DTO — an intermediate so `open_project` finishes
/// every fallible conversion *before* touching any live state (an
/// all-or-nothing replace, never leaving a project half-loaded on error).
enum LoadedDoc {
    Fa(Document),
    Mealy(MealyDocument),
    Moore(MooreDocument),
    Pda(PdaDocument),
    Tm(TmDocument),
}

fn load_doc(model: MachineDoc) -> Result<(MachineKind, LoadedDoc), String> {
    match model {
        MachineDoc::Fa(dto) => {
            let mut doc = Document::new();
            doc.model = fa_from_dto(&dto).map_err(|e| e.to_string())?;
            Ok((MachineKind::Fa, LoadedDoc::Fa(doc)))
        }
        MachineDoc::Mealy(dto) => {
            let mut doc = MealyDocument::new();
            doc.model = mealy_from_dto(&dto).map_err(|e| e.to_string())?;
            Ok((MachineKind::Mealy, LoadedDoc::Mealy(doc)))
        }
        MachineDoc::Moore(dto) => {
            let mut doc = MooreDocument::new();
            doc.model = moore_from_dto(&dto).map_err(|e| e.to_string())?;
            Ok((MachineKind::Moore, LoadedDoc::Moore(doc)))
        }
        MachineDoc::Pda(dto) => {
            let mut doc = PdaDocument::new();
            doc.model = pda_from_dto(&dto).map_err(|e| e.to_string())?;
            Ok((MachineKind::Pda, LoadedDoc::Pda(doc)))
        }
        MachineDoc::Tm(dto) => {
            let mut doc = TmDocument::new();
            doc.model = tm_from_dto(&dto).map_err(|e| e.to_string())?;
            Ok((MachineKind::Tm, LoadedDoc::Tm(doc)))
        }
    }
}

/// Reads the project file at `path` (the multi-tab project envelope from
/// `automata_core::project`, not a legacy single-document file — see this
/// module's doc comment for why `project_load_from_str`, not
/// `any_load_from_str`, is the right entry point here) and replaces the
/// current project with it entirely, allocating fresh `TabId`s in load
/// order. File-not-found, unreadable, or malformed content is an `Err`,
/// never a panic; the current project is left untouched on any such error.
pub fn open_project(project: &Mutex<ProjectSession>, sessions: &Sessions, path: String) -> Result<ProjectManifest, String> {
    let text = fs::read_to_string(&path).map_err(|e| format!("failed to read {path}: {e}"))?;
    let tabs = project_load_from_str(&text).map_err(|e| e.to_string())?;

    let mut loaded = Vec::with_capacity(tabs.len());
    for ProjectTab { name, model } in tabs {
        let (kind, doc) = load_doc(model)?;
        loaded.push((name, kind, doc));
    }

    let mut guard = project.lock().expect("project session mutex poisoned");
    guard.clear_tabs();
    clear_all_sessions(sessions);
    for (name, kind, doc) in loaded {
        let id = guard.new_tab(kind, name);
        match doc {
            LoadedDoc::Fa(d) => sessions.fa.insert(id, d),
            LoadedDoc::Mealy(d) => sessions.mealy.insert(id, d),
            LoadedDoc::Moore(d) => sessions.moore.insert(id, d),
            LoadedDoc::Pda(d) => sessions.pda.insert(id, d),
            LoadedDoc::Tm(d) => sessions.tm.insert(id, d),
        }
    }
    Ok(manifest_of(&guard, sessions))
}

/// Serializes every open tab (in `ProjectSession` order) to the project
/// envelope and writes it to `path`.
pub fn save_project(project: &Mutex<ProjectSession>, sessions: &Sessions, path: String) -> Result<ProjectManifest, String> {
    let guard = project.lock().expect("project session mutex poisoned");
    let mut tabs = Vec::with_capacity(guard.tabs().len());
    for meta in guard.tabs() {
        let model = match meta.kind {
            MachineKind::Fa => sessions.fa.try_with(meta.id, |d| MachineDoc::Fa(fa_to_dto(&d.model)))?,
            MachineKind::Mealy => sessions.mealy.try_with(meta.id, |d| MachineDoc::Mealy(mealy_to_dto(&d.model)))?,
            MachineKind::Moore => sessions.moore.try_with(meta.id, |d| MachineDoc::Moore(moore_to_dto(&d.model)))?,
            MachineKind::Pda => sessions.pda.try_with(meta.id, |d| MachineDoc::Pda(pda_to_dto(&d.model)))?,
            MachineKind::Tm => sessions.tm.try_with(meta.id, |d| MachineDoc::Tm(tm_to_dto(&d.model)))?,
        };
        tabs.push(ProjectTab { name: meta.name.clone(), model });
    }
    let json = project_save_to_string(&tabs).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("failed to write {path}: {e}"))?;
    Ok(manifest_of(&guard, sessions))
}

#[tauri::command]
pub fn project_new(
    project: tauri::State<'_, ProjectState>,
    fa: tauri::State<'_, Session>,
    mealy: tauri::State<'_, MealySession>,
    moore: tauri::State<'_, MooreSession>,
    pda: tauri::State<'_, PdaSession>,
    tm: tauri::State<'_, TmSession>,
) -> ProjectManifest {
    let sessions = Sessions { fa: &fa, mealy: &mealy, moore: &moore, pda: &pda, tm: &tm };
    new_project(&project.0, &sessions)
}

#[tauri::command]
pub fn project_manifest(
    project: tauri::State<'_, ProjectState>,
    fa: tauri::State<'_, Session>,
    mealy: tauri::State<'_, MealySession>,
    moore: tauri::State<'_, MooreSession>,
    pda: tauri::State<'_, PdaSession>,
    tm: tauri::State<'_, TmSession>,
) -> ProjectManifest {
    let sessions = Sessions { fa: &fa, mealy: &mealy, moore: &moore, pda: &pda, tm: &tm };
    manifest(&project.0, &sessions)
}

#[tauri::command]
pub fn project_new_tab(
    project: tauri::State<'_, ProjectState>,
    fa: tauri::State<'_, Session>,
    mealy: tauri::State<'_, MealySession>,
    moore: tauri::State<'_, MooreSession>,
    pda: tauri::State<'_, PdaSession>,
    tm: tauri::State<'_, TmSession>,
    kind: MachineKind,
    name: String,
) -> Result<ProjectManifest, String> {
    let sessions = Sessions { fa: &fa, mealy: &mealy, moore: &moore, pda: &pda, tm: &tm };
    new_tab(&project.0, &sessions, kind, name)
}

#[tauri::command]
pub fn project_close_tab(
    project: tauri::State<'_, ProjectState>,
    fa: tauri::State<'_, Session>,
    mealy: tauri::State<'_, MealySession>,
    moore: tauri::State<'_, MooreSession>,
    pda: tauri::State<'_, PdaSession>,
    tm: tauri::State<'_, TmSession>,
    tab_id: TabId,
) -> Result<ProjectManifest, String> {
    let sessions = Sessions { fa: &fa, mealy: &mealy, moore: &moore, pda: &pda, tm: &tm };
    close_tab(&project.0, &sessions, tab_id)
}

#[tauri::command]
pub fn project_rename_tab(
    project: tauri::State<'_, ProjectState>,
    fa: tauri::State<'_, Session>,
    mealy: tauri::State<'_, MealySession>,
    moore: tauri::State<'_, MooreSession>,
    pda: tauri::State<'_, PdaSession>,
    tm: tauri::State<'_, TmSession>,
    tab_id: TabId,
    new_name: String,
) -> Result<ProjectManifest, String> {
    let sessions = Sessions { fa: &fa, mealy: &mealy, moore: &moore, pda: &pda, tm: &tm };
    rename_tab(&project.0, &sessions, tab_id, new_name)
}

#[tauri::command]
pub fn project_reorder_tab(
    project: tauri::State<'_, ProjectState>,
    fa: tauri::State<'_, Session>,
    mealy: tauri::State<'_, MealySession>,
    moore: tauri::State<'_, MooreSession>,
    pda: tauri::State<'_, PdaSession>,
    tm: tauri::State<'_, TmSession>,
    tab_id: TabId,
    to_index: usize,
) -> Result<ProjectManifest, String> {
    let sessions = Sessions { fa: &fa, mealy: &mealy, moore: &moore, pda: &pda, tm: &tm };
    reorder_tab(&project.0, &sessions, tab_id, to_index)
}

#[tauri::command]
pub fn project_open(
    project: tauri::State<'_, ProjectState>,
    fa: tauri::State<'_, Session>,
    mealy: tauri::State<'_, MealySession>,
    moore: tauri::State<'_, MooreSession>,
    pda: tauri::State<'_, PdaSession>,
    tm: tauri::State<'_, TmSession>,
    path: String,
) -> Result<ProjectManifest, String> {
    let sessions = Sessions { fa: &fa, mealy: &mealy, moore: &moore, pda: &pda, tm: &tm };
    open_project(&project.0, &sessions, path)
}

#[tauri::command]
pub fn project_save(
    project: tauri::State<'_, ProjectState>,
    fa: tauri::State<'_, Session>,
    mealy: tauri::State<'_, MealySession>,
    moore: tauri::State<'_, MooreSession>,
    pda: tauri::State<'_, PdaSession>,
    tm: tauri::State<'_, TmSession>,
    path: String,
) -> Result<ProjectManifest, String> {
    let sessions = Sessions { fa: &fa, mealy: &mealy, moore: &moore, pda: &pda, tm: &tm };
    save_project(&project.0, &sessions, path)
}
