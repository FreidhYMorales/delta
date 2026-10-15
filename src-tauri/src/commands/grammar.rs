//! `grammar_snapshot` / `grammar_set_source` / `grammar_set_notation` /
//! `grammar_derive` — the "Gramática" tab's IPC
//! (`GrammarSession`). The document is just the grammar's source text
//! (`automata_core::grammar_doc::GrammarDocument`); every snapshot also
//! carries the text's analysis (parsed G = {Σ, N, S, P}, its Chomsky
//! classification, or the parse error), so the frontend never parses or
//! classifies anything itself.

use serde::Serialize;

use automata_core::grammar::derive::{derive as derive_string, Derivation, DerivationOrder};
use automata_core::grammar_doc::{GrammarAnalysis, GrammarDocument, Notation};

use crate::state::GrammarSession;
use crate::tabs::TabId;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GrammarSnapshot {
    pub revision: u64,
    pub source: String,
    pub notation: Notation,
    pub analysis: GrammarAnalysis,
}

fn snapshot_of(doc: &GrammarDocument) -> GrammarSnapshot {
    GrammarSnapshot { revision: doc.revision, source: doc.source.clone(), notation: doc.notation, analysis: doc.analysis() }
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

/// Switches how the tab's text is read (plain productions or BNF/EBNF).
pub fn set_notation(session: &GrammarSession, tab: TabId, notation: Notation) -> Result<GrammarSnapshot, String> {
    session.try_with_mut(tab, |doc| {
        doc.set_notation(notation);
        snapshot_of(doc)
    })
}

/// Derives `input` from the tab's current grammar (whether it is
/// generated, the derivation and its tree), from `start` when given — a BNF
/// text defines many rules worth testing on their own — else from the
/// grammar's start symbol. An unparsable grammar is an error carrying the
/// parse message.
pub fn derive(
    session: &GrammarSession,
    tab: TabId,
    input: String,
    order: DerivationOrder,
    start: Option<String>,
) -> Result<Derivation, String> {
    session.try_with(tab, |doc| {
        let analysis = doc.analysis();
        let Some(mut grammar) = analysis.grammar else {
            return Err(analysis.error.map_or_else(|| "la gramática no es válida".to_string(), |e| e.to_string()));
        };
        if let Some(start) = start {
            if !grammar.nonterminals.contains(&start) {
                return Err(format!("«{start}» no es un no terminal de la gramática"));
            }
            grammar.start = start;
        }
        Ok(derive_string(&grammar, &input, order))
    })?
}

#[tauri::command]
pub fn grammar_derive(
    session: tauri::State<'_, GrammarSession>,
    tab_id: TabId,
    input: String,
    order: DerivationOrder,
    start: Option<String>,
) -> Result<Derivation, String> {
    derive(&session, tab_id, input, order, start)
}

#[tauri::command]
pub fn grammar_set_notation(
    session: tauri::State<'_, GrammarSession>,
    tab_id: TabId,
    notation: Notation,
) -> Result<GrammarSnapshot, String> {
    set_notation(&session, tab_id, notation)
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
    use automata_core::grammar::derive::DeriveOutcome;

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
    fn derive_uses_the_tabs_grammar() {
        let tab = TabId(1);
        let session = session_with_tab(tab);
        set_source(&session, tab, "S -> aS | b".into()).unwrap();
        let d = derive(&session, tab, "aab".into(), DerivationOrder::Leftmost, None).unwrap();
        assert_eq!(d.outcome, DeriveOutcome::Accepted);
        assert_eq!(d.forms, vec!["S", "aS", "aaS", "aab"]);
    }

    #[test]
    fn derive_on_an_invalid_grammar_reports_the_parse_error() {
        let tab = TabId(1);
        let session = session_with_tab(tab);
        set_source(&session, tab, "S a".into()).unwrap();
        let err = derive(&session, tab, "a".into(), DerivationOrder::Leftmost, None).unwrap_err();
        assert!(err.contains("línea 1"), "{err}");
    }

    #[test]
    fn set_notation_rereads_the_text_and_reports_the_notation() {
        let tab = TabId(2);
        let session = session_with_tab(tab);
        set_source(&session, tab, "signo ::= '+' | '-' .".into()).unwrap();
        let snap = set_notation(&session, tab, Notation::Bnf).unwrap();
        assert_eq!(snap.notation, Notation::Bnf);
        assert!(snap.analysis.error.is_none());
        assert!(snap.analysis.expansion.is_some());
    }

    #[test]
    fn derive_can_start_from_any_non_terminal() {
        let tab = TabId(2);
        let session = session_with_tab(tab);
        set_source(&session, tab, "entero ::= [ signo ] d.\nsigno ::= '+' | '-'.\nd ::= '1'.".into()).unwrap();
        set_notation(&session, tab, Notation::Bnf).unwrap();
        let from_sign = derive(&session, tab, "-".into(), DerivationOrder::Leftmost, Some("signo".into())).unwrap();
        assert_eq!(from_sign.outcome, DeriveOutcome::Accepted);
        let from_start = derive(&session, tab, "-".into(), DerivationOrder::Leftmost, None).unwrap();
        assert_eq!(from_start.outcome, DeriveOutcome::Rejected);
    }

    #[test]
    fn an_unknown_tab_is_an_error_not_a_panic() {
        let session = GrammarSession::new();
        assert!(snapshot(&session, TabId(9)).is_err());
        assert!(set_source(&session, TabId(9), "S -> a".into()).is_err());
    }
}
