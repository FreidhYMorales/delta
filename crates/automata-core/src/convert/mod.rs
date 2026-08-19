//! Conversions in and out of the finite-automaton model: `nfa_to_dfa`
//! (subset construction), `minimize_dfa` (partition refinement),
//! `fa_to_regular_grammar`/`regular_grammar_to_nfa` (right-linear grammar,
//! both directions), and `fa_to_regex`/`regex_to_nfa` (regular expression,
//! both directions). PDA/Turing-machine conversions are future additions
//! per the roadmap (see `../../../docs/decisions.md` and the README's
//! "Pendiente" list).

pub mod fa_to_grammar;
pub mod fa_to_regex;
pub mod minimize_dfa;
pub mod nfa_to_dfa;
pub mod regex_to_nfa;

pub use fa_to_grammar::{fa_to_regular_grammar, regular_grammar_to_nfa};
pub use fa_to_regex::fa_to_regex;
pub use minimize_dfa::{minimize_dfa, MinimizeError};
pub use nfa_to_dfa::nfa_to_dfa;
pub use regex_to_nfa::regex_to_nfa;
