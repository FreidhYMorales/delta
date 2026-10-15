//! The "Gramática" tab's document: the grammar's source text, as typed.
//!
//! Unlike the machine documents (`doc`, `tm_doc`, …) there is no edit-op
//! model or undo history here — the text box's own undo covers editing —
//! just the text and a revision that moves whenever it changes, which is
//! what the project's "unsaved changes" tracking reads. Everything shown
//! about the grammar (Σ, N, S, P, its Chomsky type) is derived from the
//! text on demand (`analysis`).

use serde::Serialize;

use crate::grammar::chomsky::{classify, Classification};
use crate::grammar::general::{parse_general, GeneralGrammar, GrammarError};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GrammarDocument {
    pub source: String,
    pub revision: u64,
}

/// Everything the tab shows about the current text: the parsed grammar and
/// its classification, or the parse error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GrammarAnalysis {
    pub grammar: Option<GeneralGrammar>,
    pub classification: Option<Classification>,
    pub error: Option<GrammarError>,
}

impl GrammarDocument {
    pub fn new() -> Self {
        Self::default()
    }

    /// Replaces the text; the revision moves only if it actually changed.
    pub fn set_source(&mut self, source: String) {
        if source != self.source {
            self.source = source;
            self.revision += 1;
        }
    }

    pub fn analysis(&self) -> GrammarAnalysis {
        match parse_general(&self.source) {
            Ok(grammar) => {
                let classification = classify(&grammar);
                GrammarAnalysis { grammar: Some(grammar), classification: Some(classification), error: None }
            }
            Err(error) => GrammarAnalysis { grammar: None, classification: None, error: Some(error) },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revision_moves_only_when_the_text_changes() {
        let mut doc = GrammarDocument::new();
        doc.set_source("S -> a".into());
        assert_eq!(doc.revision, 1);
        doc.set_source("S -> a".into());
        assert_eq!(doc.revision, 1);
        doc.set_source("S -> b".into());
        assert_eq!(doc.revision, 2);
    }

    #[test]
    fn analysis_of_a_valid_grammar_has_the_grammar_and_its_type() {
        let mut doc = GrammarDocument::new();
        doc.set_source("S -> aS | b".into());
        let analysis = doc.analysis();
        assert!(analysis.error.is_none());
        assert_eq!(analysis.grammar.unwrap().start, "S");
        assert_eq!(analysis.classification.unwrap().chomsky_type, 3);
    }

    #[test]
    fn analysis_of_invalid_text_has_only_the_error() {
        let mut doc = GrammarDocument::new();
        doc.set_source("S a".into());
        let analysis = doc.analysis();
        assert!(analysis.grammar.is_none() && analysis.classification.is_none());
        assert_eq!(analysis.error.unwrap().line, 1);
    }

    #[test]
    fn an_empty_document_reports_the_missing_productions_error() {
        assert!(GrammarDocument::new().analysis().error.is_some());
    }
}
