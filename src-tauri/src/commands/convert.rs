//! `conv_to_regex` / `conv_from_regex` and `conv_to_grammar` /
//! `conv_from_grammar` — both directions of the FA<->regex and
//! FA<->right-linear-grammar loops (`automata_core::convert::*`), the
//! "Expresión Regular" / "Gramática Regular" entries in the toolbar's
//! Editor dropdown (`frontend/src/views/toolbar/Toolbar.js`) jump to.
//!
//! `conv_nfa_to_dfa` / `conv_minimize_dfa` are a different shape: FA -> FA,
//! not FA -> a different representation, so unlike the regex/grammar pair
//! they're never a whole-document replacement — the frontend (`main.js`'s
//! `ctx.convertToDfa`/`ctx.minimizeDfa`) diffs the returned preview against
//! the live document and applies the result through the normal
//! `docStore.apply` undo/redo path (reusing `formalLogic.js`'s
//! `planStateDiff`/`planSyncOps`, the same machinery `FormalView` already
//! uses), so Ctrl+Z undoes a conversion exactly like any other edit. These
//! two commands only ever *preview* the target — read-only, same as
//! `to_regex`/`to_grammar`.

use automata_core::convert::{
    fa_to_regex, fa_to_regular_grammar, minimize_dfa, nfa_to_dfa, regex_to_nfa, regular_grammar_to_nfa,
};
use automata_core::doc::{Document, History};
use automata_core::grammar::RegularGrammar;
use automata_core::regex::Regex;

use crate::ipc::{snapshot_of, DocSnapshot};
use crate::state::Session;
use crate::tabs::TabId;

/// Wraps a freestanding `FaDoc` (never the session's own model) in a
/// scratch `Document` purely to reuse `snapshot_of`'s serialization —
/// `history`/`revision` are meaningless here since this is never stored
/// back into the session.
fn preview_snapshot(model: automata_core::model::fa::FaDoc) -> DocSnapshot {
    snapshot_of(&Document { model, history: History::new(0), revision: 0 })
}

/// Plain, directly-testable logic (mirrors `commands::doc`/`commands::sim`'s
/// convention: plain fn takes `&Session`, the `#[tauri::command]` wrapper
/// below owns the literal design-mandated invoke name). Read-only: never
/// mutates the document, so unlike `doc`/`sim` there's no `EditResult`/
/// revision to thread through, just the derived string. `fa_to_regex`
/// itself always succeeds — an empty document or one with no initial state
/// correctly reduces to `∅`, not an error case this needs to special-case.
pub fn to_regex(session: &Session, tab: TabId) -> Result<String, String> {
    session.try_with(tab, |doc| fa_to_regex(&doc.model).to_string())
}

/// Replaces the session's current document with the NFA that `pattern`
/// (Thompson's construction, `regex_to_nfa`) builds — same "whole-document
/// replacement, fresh undo history" shape as `commands::doc::open` loading
/// a file, since generating from a regex is exactly that: swapping in a
/// different document, not an edit to the current one. Rejects `pattern`
/// with the parser's own (Spanish, user-facing — see `regex/parser.rs`'s
/// doc comment) error message on invalid syntax, leaving the session
/// untouched.
pub fn from_regex(session: &Session, tab: TabId, pattern: String) -> Result<DocSnapshot, String> {
    let regex: Regex = pattern.parse().map_err(|e: automata_core::regex::ParseError| e.to_string())?;
    let model = regex_to_nfa(&regex);
    session.try_with_mut(tab, |doc| {
        let next_revision = doc.revision + 1;
        *doc = Document { model, history: History::new(200), revision: next_revision };
        snapshot_of(doc)
    })
}

/// Same read-only shape as `to_regex`, for the "Gramática regular
/// equivalente" box. Uses `grammar::format` — not `RegularGrammar`'s own
/// `Display` (a more compact, `automata-cli`-oriented rendering, delimiter
/// -free between a production's symbol and its destination) — specifically
/// so what's shown here is always copy-paste-able straight back into the
/// "Generar autómata" box below it (see `grammar/parser.rs`'s doc comment
/// for exactly why the two renderings differ).
pub fn to_grammar(session: &Session, tab: TabId) -> Result<String, String> {
    session.try_with(tab, |doc| automata_core::grammar::format(&fa_to_regular_grammar(&doc.model)))
}

/// Same "whole-document replacement" shape as `from_regex`, for a typed
/// right-linear grammar instead of a regex.
pub fn from_grammar(session: &Session, tab: TabId, text: String) -> Result<DocSnapshot, String> {
    let grammar: RegularGrammar =
        text.parse().map_err(|e: automata_core::grammar::ParseError| e.to_string())?;
    let model = regular_grammar_to_nfa(&grammar);
    session.try_with_mut(tab, |doc| {
        let next_revision = doc.revision + 1;
        *doc = Document { model, history: History::new(200), revision: next_revision };
        snapshot_of(doc)
    })
}

#[tauri::command]
pub fn conv_to_regex(session: tauri::State<'_, Session>, tab_id: TabId) -> Result<String, String> {
    to_regex(&session, tab_id)
}

#[tauri::command]
pub fn conv_from_regex(
    session: tauri::State<'_, Session>,
    tab_id: TabId,
    pattern: String,
) -> Result<DocSnapshot, String> {
    from_regex(&session, tab_id, pattern)
}

#[tauri::command]
pub fn conv_to_grammar(session: tauri::State<'_, Session>, tab_id: TabId) -> Result<String, String> {
    to_grammar(&session, tab_id)
}

#[tauri::command]
pub fn conv_from_grammar(
    session: tauri::State<'_, Session>,
    tab_id: TabId,
    text: String,
) -> Result<DocSnapshot, String> {
    from_grammar(&session, tab_id, text)
}

/// Preview of the equivalent DFA (subset construction) — never mutates the
/// session. `nfa_to_dfa` always succeeds: a document with no initial state
/// previews as the empty automaton (zero states), same "no special-casing
/// needed" shape as `fa_to_regex`'s `∅`.
pub fn nfa_to_dfa_preview(session: &Session, tab: TabId) -> Result<DocSnapshot, String> {
    session.try_with(tab, |doc| preview_snapshot(nfa_to_dfa(&doc.model)))
}

/// Preview of the minimized DFA (Moore partition refinement) — never
/// mutates the session. Rejects (mirrors `MinimizeError`'s own English
/// message — unlike the regex/grammar parsers, this isn't new user-facing
/// copy, it's the same message `automata-cli` already prints) when the
/// current document isn't already deterministic; the frontend action is
/// gated on `derived.classification === "Dfa"` so this is normally
/// unreachable, not the primary way a user finds out.
pub fn minimize_dfa_preview(session: &Session, tab: TabId) -> Result<DocSnapshot, String> {
    session.try_with(tab, |doc| minimize_dfa(&doc.model).map_err(|e| e.to_string()).map(preview_snapshot))?
}

#[tauri::command]
pub fn conv_nfa_to_dfa(session: tauri::State<'_, Session>, tab_id: TabId) -> Result<DocSnapshot, String> {
    nfa_to_dfa_preview(&session, tab_id)
}

#[tauri::command]
pub fn conv_minimize_dfa(session: tauri::State<'_, Session>, tab_id: TabId) -> Result<DocSnapshot, String> {
    minimize_dfa_preview(&session, tab_id)
}
