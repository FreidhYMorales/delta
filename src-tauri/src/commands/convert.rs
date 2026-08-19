//! `conv_to_regex` — the regular expression equivalent to the session's
//! current automaton (`automata_core::convert::fa_to_regex`), closing the
//! FA<->regex loop for the frontend (first step towards a real "Expresión
//! Regular" editor mode — see `frontend/src/views/toolbar/Toolbar.js`).
//! Read-only: never mutates the document, so unlike `doc`/`sim` there's no
//! `EditResult`/revision to thread through, just the derived string.

use automata_core::convert::fa_to_regex;

use crate::state::Session;

/// Plain, directly-testable logic (mirrors `commands::doc`/`commands::sim`'s
/// convention: plain fn takes `&Session`, the `#[tauri::command]` wrapper
/// below owns the literal design-mandated invoke name). `fa_to_regex`
/// itself always succeeds — an empty document or one with no initial state
/// correctly reduces to `∅`, not an error case this needs to special-case.
pub fn to_regex(session: &Session) -> String {
    let doc = session.0.lock().expect("session mutex poisoned");
    fa_to_regex(&doc.model).to_string()
}

#[tauri::command]
pub fn conv_to_regex(session: tauri::State<'_, Session>) -> String {
    to_regex(&session)
}
