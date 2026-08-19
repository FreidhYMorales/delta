//! Regular (right-linear) grammar model — what `convert::fa_to_regular_grammar`
//! produces and `convert::regular_grammar_to_nfa` consumes. Verified against
//! JFLAP's own `grammar.reg.RegularGrammar` / `automata.fsa.FSAToRegularGrammarConverter`
//! (see `docs/decisions.md`).
//!
//! Unlike JFLAP — which names non-terminals `S` for the start symbol, then
//! `A`, `B`, `C`... (capped at 26 states) — non-terminals here are just the
//! original automaton's own state labels. No cap, and a production traces
//! back to exactly the state it came from at a glance.

use std::fmt;

pub mod parser;
pub use parser::{format, parse, ParseError};

/// A right-linear production: `lhs -> symbol rhs` (`Derive`) or `lhs -> ε`
/// (`Terminate`). `symbol` may be the empty string for a source epsilon
/// transition — that is still a `Derive` (it names a `rhs` non-terminal),
/// not a `Terminate`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Production {
    Derive { lhs: String, symbol: String, rhs: String },
    Terminate { lhs: String },
}

impl Production {
    pub fn lhs(&self) -> &str {
        match self {
            Production::Derive { lhs, .. } | Production::Terminate { lhs } => lhs,
        }
    }
}

impl fmt::Display for Production {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Production::Derive { lhs, symbol, rhs } if symbol.is_empty() => write!(f, "{lhs} -> {rhs}"),
            Production::Derive { lhs, symbol, rhs } => write!(f, "{lhs} -> {symbol}{rhs}"),
            Production::Terminate { lhs } => write!(f, "{lhs} -> ε"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RegularGrammar {
    /// `None` only when the source automaton had no initial state.
    pub start: Option<String>,
    pub productions: Vec<Production>,
}

impl fmt::Display for RegularGrammar {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for p in &self.productions {
            writeln!(f, "{p}")?;
        }
        Ok(())
    }
}
