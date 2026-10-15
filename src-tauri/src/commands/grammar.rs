//! `grammar_snapshot` / `grammar_set_source` — the "Gramática" tab's IPC
//! (`GrammarSession`). The document is just the grammar's source text
//! (`automata_core::grammar_doc::GrammarDocument`); every snapshot also
//! carries the text's analysis (parsed G = {Σ, N, S, P}, its Chomsky
//! classification, or the parse error), so the frontend never parses or
//! classifies anything itself.

use serde::Serialize;

use automata_core::grammar_doc::{GrammarAnalysis, GrammarDocument};

use crate::state::GrammarSession;
use crate::tabs::TabId;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GrammarSnapshot {
    pub revision: u64,
    pub source: String,
    pub analysis: GrammarAnalysis,
}

fn snapshot_of(doc: &GrammarDocument) -> GrammarSnapshot {
    GrammarSnapshot { revision: doc.revision, source: doc.source.clone(), analysis: doc.analysis() }
}

pub fn snapshot(session: &GrammarSession, tab: TabId) -> Result<GrammarSnapshot, String> {
    session.try_with(tab, snapshot_of)
}

/// Replaces the tab's text (the revision moves only if it changed) and
/// returns the new snapshot, analysis included.
pub fn set_source(session: &GrammarSession, tab: TabId, source: String) -> Result<GrammarSnapshot, String> {
    session.try_with_mut(tab, |doc| {
        doc.set_source(source);
        snapshot_of(doc)
    })
}

#[tauri::command]
pub fn grammar_snapshot(session: tauri::State<'_, GrammarSession>, tab_id: TabId) -> Result<GrammarSnapshot, String> {
    snapshot(&session, tab_id)
}

#[tauri::command]
pub fn grammar_set_source(
    session: tauri::State<'_, GrammarSession>,
    tab_id: TabId,
    source: String,
) -> Result<GrammarSnapshot, String> {
    set_source(&session, tab_id, source)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session_with_tab(id: TabId) -> GrammarSession {
        let session = GrammarSession::new();
        session.insert(id, GrammarDocument::new());
        session
    }

    #[test]
    fn set_source_stores_the_text_and_returns_its_analysis() {
        let tab = TabId(3);
        let session = session_with_tab(tab);
        let snap = set_source(&session, tab, "S -> aS | b".into()).unwrap();
        assert_eq!(snap.revision, 1);
        assert_eq!(snap.source, "S -> aS | b");
        assert_eq!(snap.analysis.classification.unwrap().chomsky_type, 3);
        assert_eq!(snapshot(&session, tab).unwrap().source, "S -> aS | b");
    }

    #[test]
    fn an_unknown_tab_is_an_error_not_a_panic() {
        let session = GrammarSession::new();
        assert!(snapshot(&session, TabId(9)).is_err());
        assert!(set_source(&session, TabId(9), "S -> a".into()).is_err());
    }
}
