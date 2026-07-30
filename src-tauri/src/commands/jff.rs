//! `jff_import` / `jff_export` (design D3/D5, spec domain `jflap-interop`).
//! Thin wrappers over `automata_core::interop::jff::{reader, writer}`
//! (PR3): both directions always return an `InteropReport`, never swallowed
//! (spec "Visible Loss Report on Lossy Conversion").

use std::fs;

use automata_core::doc::{Document, History};
use automata_core::interop::jff::{reader, writer, InteropReport, LossItem, Subject};

use crate::ipc::{snapshot_of, DocSnapshot};
use crate::state::Session;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind")]
pub enum SubjectDto {
    Document,
    State { label: String },
    Edge { from: String, to: String },
}

impl From<&Subject> for SubjectDto {
    fn from(s: &Subject) -> Self {
        match s {
            Subject::Document => SubjectDto::Document,
            Subject::State(label) => SubjectDto::State { label: label.clone() },
            Subject::Edge { from, to } => SubjectDto::Edge { from: from.clone(), to: to.clone() },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LossItemDto {
    pub severity: String,
    pub code: String,
    pub subject: SubjectDto,
    pub detail: String,
}

impl From<&LossItem> for LossItemDto {
    fn from(item: &LossItem) -> Self {
        use automata_core::interop::jff::{LossCode, Severity};
        let severity = match item.severity {
            Severity::Info => "Info",
            Severity::Lossy => "Lossy",
            Severity::Dropped => "Dropped",
        }
        .to_string();
        let code = match item.code {
            LossCode::NonFaType => "NonFaType",
            LossCode::MultiCharSymbol => "MultiCharSymbol",
            LossCode::MultipleInitialStates => "MultipleInitialStates",
            LossCode::NoInitialState => "NoInitialState",
            LossCode::DuplicateStateName => "DuplicateStateName",
            LossCode::UnknownElementDropped => "UnknownElementDropped",
            LossCode::GeometryDefaulted => "GeometryDefaulted",
        }
        .to_string();
        LossItemDto { severity, code, subject: (&item.subject).into(), detail: item.detail.clone() }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct InteropReportDto {
    pub direction: String,
    pub items: Vec<LossItemDto>,
}

impl From<&InteropReport> for InteropReportDto {
    fn from(report: &InteropReport) -> Self {
        use automata_core::interop::jff::Direction;
        let direction = match report.direction {
            Direction::Import => "Import",
            Direction::Export => "Export",
        }
        .to_string();
        InteropReportDto { direction, items: report.items.iter().map(Into::into).collect() }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct JffImportResult {
    pub snapshot: DocSnapshot,
    pub report: InteropReportDto,
}

/// Import `path`, replacing the session's document entirely on success. On
/// failure (`JffError`) the session is left completely unchanged — the
/// reader never hands back a partial `FaDoc` (spec "Reject non-FA .jff
/// content" / "Malformed file"), so there is nothing to roll back here.
pub fn import(session: &Session, path: String) -> Result<JffImportResult, String> {
    let xml = fs::read_to_string(&path).map_err(|e| format!("failed to read {path}: {e}"))?;
    let (model, report) = reader::import_str(&xml).map_err(|e| e.to_string())?;
    let mut doc = session.0.lock().map_err(|_| "session mutex poisoned".to_string())?;
    let next_revision = doc.revision + 1;
    *doc = Document { model, history: History::new(200), revision: next_revision };
    Ok(JffImportResult { snapshot: snapshot_of(&doc), report: (&report).into() })
}

pub fn export(session: &Session, path: String) -> Result<InteropReportDto, String> {
    let doc = session.0.lock().map_err(|_| "session mutex poisoned".to_string())?;
    let (xml, report) = writer::export_to_string(&doc.model);
    fs::write(&path, xml).map_err(|e| format!("failed to write {path}: {e}"))?;
    Ok((&report).into())
}

#[tauri::command]
pub fn jff_import(session: tauri::State<'_, Session>, path: String) -> Result<JffImportResult, String> {
    import(&session, path)
}

#[tauri::command]
pub fn jff_export(session: tauri::State<'_, Session>, path: String) -> Result<InteropReportDto, String> {
    export(&session, path)
}
