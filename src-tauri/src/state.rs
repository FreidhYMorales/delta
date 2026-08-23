//! Tauri-managed application state (design D3): a single in-memory
//! `Document`, guarded by a mutex, shared across every IPC command via
//! `tauri::State<'_, Session>`.
//!
//! `MealySession`/`MooreSession`/`PdaSession` are each a genuinely separate
//! piece of managed state, not a variant of `Session` — same "isolated, not
//! a generalization" choice as `MealyDoc`/`MooreDoc`/`PdaDoc` vs `FaDoc`
//! (docs/decisions.md). All four are always managed (`.manage(...)` in
//! `lib.rs`) regardless of which editor mode the frontend currently shows;
//! only one is *addressed* by IPC calls at a time, decided by which set of
//! commands the frontend calls.

use std::sync::Mutex;

use automata_core::doc::Document;
use automata_core::mealy_doc::MealyDocument;
use automata_core::moore_doc::MooreDocument;
use automata_core::pda_doc::PdaDocument;

pub struct Session(pub Mutex<Document>);

impl Session {
    pub fn new() -> Self {
        Session(Mutex::new(Document::new()))
    }
}

impl Default for Session {
    fn default() -> Self {
        Self::new()
    }
}

pub struct MealySession(pub Mutex<MealyDocument>);

impl MealySession {
    pub fn new() -> Self {
        MealySession(Mutex::new(MealyDocument::new()))
    }
}

impl Default for MealySession {
    fn default() -> Self {
        Self::new()
    }
}

pub struct MooreSession(pub Mutex<MooreDocument>);

impl MooreSession {
    pub fn new() -> Self {
        MooreSession(Mutex::new(MooreDocument::new()))
    }
}

impl Default for MooreSession {
    fn default() -> Self {
        Self::new()
    }
}

pub struct PdaSession(pub Mutex<PdaDocument>);

impl PdaSession {
    pub fn new() -> Self {
        PdaSession(Mutex::new(PdaDocument::new()))
    }
}

impl Default for PdaSession {
    fn default() -> Self {
        Self::new()
    }
}
