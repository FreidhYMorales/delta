//! `conv_to_regex` / `conv_from_regex` — the two directions of the FA<->regex
//! loop (`automata_core::convert::{fa_to_regex, regex_to_nfa}`), first step
//! towards a real "Expresión Regular" editor mode — see
//! `frontend/src/views/toolbar/Toolbar.js`.

use automata_core::convert::{fa_to_regex, regex_to_nfa};
use automata_core::doc::{Document, History};
use automata_core::regex::Regex;

use crate::ipc::{snapshot_of, DocSnapshot};
use crate::state::Session;

/// Plain, directly-testable logic (mirrors `commands::doc`/`commands::sim`'s
/// convention: plain fn takes `&Session`, the `#[tauri::command]` wrapper
/// below owns the literal design-mandated invoke name). Read-only: never
/// mutates the document, so unlike `doc`/`sim` there's no `EditResult`/
/// revision to thread through, just the derived string. `fa_to_regex`
/// itself always succeeds — an empty document or one with no initial state
/// correctly reduces to `∅`, not an error case this needs to special-case.
pub fn to_regex(session: &Session) -> String {
    let doc = session.0.lock().expect("session mutex poisoned");
    fa_to_regex(&doc.model).to_string()
}

/// Replaces the session's current document with the NFA that `pattern`
/// (Thompson's construction, `regex_to_nfa`) builds — same "whole-document
/// replacement, fresh undo history" shape as `commands::doc::open` loading
/// a file, since generating from a regex is exactly that: swapping in a
/// different document, not an edit to the current one. Rejects `pattern`
/// with the parser's own (Spanish, user-facing — see `regex/parser.rs`'s
/// doc comment) error message on invalid syntax, leaving the session
/// untouched.
pub fn from_regex(session: &Session, pattern: String) -> Result<DocSnapshot, String> {
    let regex: Regex = pattern.parse().map_err(|e: automata_core::regex::ParseError| e.to_string())?;
    let model = regex_to_nfa(&regex);
    let mut doc = session.0.lock().map_err(|_| "session mutex poisoned".to_string())?;
    let next_revision = doc.revision + 1;
    *doc = Document { model, history: History::new(200), revision: next_revision };
    Ok(snapshot_of(&doc))
}

#[tauri::command]
pub fn conv_to_regex(session: tauri::State<'_, Session>) -> String {
    to_regex(&session)
}

#[tauri::command]
pub fn conv_from_regex(session: tauri::State<'_, Session>, pattern: String) -> Result<DocSnapshot, String> {
    from_regex(&session, pattern)
}
