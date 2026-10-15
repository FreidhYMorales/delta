//! The "Gramática" tab's document: the grammar's source text, as typed, and
//! the notation it is written in (plain productions or BNF/EBNF).
//!
//! Unlike the machine documents (`doc`, `tm_doc`, …) there is no edit-op
//! model or undo history here — the text box's own undo covers editing —
//! just the text and a revision that moves whenever it changes, which is
//! what the project's "unsaved changes" tracking reads. Everything shown
//! about the grammar (Σ, N, S, P, its Chomsky type) is derived from the
//! text on demand (`analysis`).

use serde::{Deserialize, Serialize};

use crate::grammar::bnf::parse_bnf;
use crate::grammar::chomsky::{classify, Classification};
use crate::grammar::general::{parse_general, GeneralGrammar, GrammarError};

/// How the source text is written: `S -> aB` productions, or BNF/EBNF
/// (`entero ::= [ signo ] digito { digito } .`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Notation {
    #[default]
    Productions,
    Bnf,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GrammarDocument {
    pub source: String,
    pub notation: Notation,
    pub revision: u64,
}

/// Everything the tab shows about the current text: the parsed grammar and
/// its classification (plus, for BNF/EBNF, the plain-BNF rules it expands
/// to), or the parse error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GrammarAnalysis {
    pub grammar: Option<GeneralGrammar>,
    pub classification: Option<Classification>,
    pub expansion: Option<Vec<String>>,
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

    /// Switches how the text is read; the revision moves only on a change.
    pub fn set_notation(&mut self, notation: Notation) {
        if notation != self.notation {
            self.notation = notation;
            self.revision += 1;
        }
    }

    pub fn analysis(&self) -> GrammarAnalysis {
        let parsed = match self.notation {
            Notation::Productions => parse_general(&self.source).map(|grammar| (grammar, None)),
            Notation::Bnf => parse_bnf(&self.source).map(|b| (b.grammar, Some(b.expansion))),
        };
        match parsed {
            Ok((grammar, expansion)) => {
                let classification = classify(&grammar);
                GrammarAnalysis { grammar: Some(grammar), classification: Some(classification), expansion, error: None }
            }
            Err(error) => GrammarAnalysis { grammar: None, classification: None, expansion: None, error: Some(error) },
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
    fn switching_notation_moves_the_revision_and_reads_the_text_as_bnf() {
        let mut doc = GrammarDocument::new();
        doc.set_source("entero ::= [ '-' ] d { d }.\nd ::= '0' | '1'.".into());
        assert!(doc.analysis().error.is_some(), "not valid as plain productions");
        let before = doc.revision;
        doc.set_notation(Notation::Bnf);
        assert_eq!(doc.revision, before + 1);
        doc.set_notation(Notation::Bnf);
        assert_eq!(doc.revision, before + 1);
        let analysis = doc.analysis();
        assert!(analysis.error.is_none(), "{:?}", analysis.error);
        assert_eq!(analysis.grammar.unwrap().start, "entero");
        assert!(analysis.expansion.unwrap().iter().any(|line| line.starts_with("entero_rep1 ::=")));
    }

    #[test]
    fn plain_productions_have_no_ebnf_expansion() {
        let mut doc = GrammarDocument::new();
        doc.set_source("S -> a".into());
        assert!(doc.analysis().expansion.is_none());
    }

    #[test]
    fn an_empty_document_reports_the_missing_productions_error() {
        assert!(GrammarDocument::new().analysis().error.is_some());
    }
}
