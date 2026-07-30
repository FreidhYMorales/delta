//! Tauri-managed application state (design D3): a single in-memory
//! `Document`, guarded by a mutex, shared across every IPC command via
//! `tauri::State<'_, Session>`.

use std::sync::Mutex;

use automata_core::doc::Document;

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
