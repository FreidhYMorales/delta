//! Parser for the text syntax accepted when generating an automaton from a
//! typed grammar (`conv_from_grammar`) — one right-linear production per
//! line: `LHS -> SYMBOL RHS` (space-separated), `LHS -> RHS` (a
//! symbol-less/epsilon-labeled derive), or `LHS -> ε` (a terminating
//! production). The **start symbol is whichever non-terminal is the `lhs`
//! of the first production** — same convention JFLAP itself uses when a
//! grammar is typed by hand.
//!
//! Deliberately NOT the exact inverse of `RegularGrammar`'s own `Display`
//! (unlike `regex/parser.rs`, which genuinely is the inverse of `Regex`'s
//! `Display`): `Display` prints a `Derive` production as `lhs -> symbolrhs`
//! with **no delimiter** between `symbol` and `rhs` — fine for a human
//! reading `q0 -> aq1`, but ambiguous for a parser to split back apart,
//! because non-terminals here are arbitrary-length state labels (`q0`,
//! `q10`, ...), not single letters the way regex's "every character is its
//! own symbol" convention makes concatenation unambiguous. A single
//! required space between the symbol and the destination non-terminal
//! resolves that outright, at the cost of not matching `Display`'s compact
//! form byte-for-byte. `format` (below) is this parser's own matching
//! inverse — `GrammarView` shows grammars in `format`'s syntax, specifically
//! so what's displayed is always copy-paste-able straight back into the
//! generate box, instead of showing one syntax and expecting another.
//!
//! Error messages are Spanish, user-facing text — same reasoning as
//! `regex/parser.rs`'s: shown verbatim in the frontend the moment a student
//! mistypes a grammar.

use std::str::FromStr;

use super::{Production, RegularGrammar};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message} (línea {line})")]
pub struct ParseError {
    pub message: String,
    /// 1-indexed source line; `0` for whole-input errors (e.g. empty input).
    pub line: usize,
}

impl ParseError {
    fn at(line: usize, message: impl Into<String>) -> Self {
        ParseError { message: message.into(), line }
    }
}

/// Parse `input` as a right-linear grammar. Blank lines are ignored
/// wherever they appear. Rejects an input with no productions at all,
/// same reasoning as `regex::parser::parse` rejecting empty text — there is
/// no sensible "default" grammar to fall back to.
pub fn parse(input: &str) -> Result<RegularGrammar, ParseError> {
    let mut productions = Vec::new();
    let mut explicit_start: Option<String> = None;
    let mut first_production_lhs: Option<String> = None;

    for (i, raw_line) in input.lines().enumerate() {
        let line = i + 1;
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Optional header, only needed when the start state has no
        // production of its own to imply it (see `format`'s doc comment) —
        // "inicio:" can't collide with a production line: a state actually
        // named "inicio" would read "inicio -> ..." (a hyphen right after,
        // never a colon).
        if let Some(rest) = trimmed.strip_prefix("inicio:") {
            let label = rest.trim();
            if label.is_empty() {
                return Err(ParseError::at(line, "falta el nombre del estado después de 'inicio:'"));
            }
            if explicit_start.is_some() {
                return Err(ParseError::at(line, "el estado inicial ya fue indicado — solo puede haber un 'inicio:'"));
            }
            explicit_start = Some(label.to_string());
            continue;
        }

        let Some((lhs_part, rhs_part)) = trimmed.split_once("->") else {
            return Err(ParseError::at(line, "falta '->' en la producción"));
        };
        let lhs = lhs_part.trim();
        if lhs.is_empty() {
            return Err(ParseError::at(line, "falta el lado izquierdo (no terminal) de la producción"));
        }

        let rhs_tokens: Vec<&str> = rhs_part.split_whitespace().collect();
        let production = match rhs_tokens.as_slice() {
            [] => return Err(ParseError::at(line, "falta el lado derecho de la producción")),
            [rhs] if *rhs == "\u{03b5}" => Production::Terminate { lhs: lhs.to_string() },
            [rhs] => {
                Production::Derive { lhs: lhs.to_string(), symbol: String::new(), rhs: rhs.to_string() }
            }
            [symbol, rhs] => {
                if symbol.chars().count() != 1 {
                    return Err(ParseError::at(line, "el símbolo debe ser un solo carácter"));
                }
                Production::Derive { lhs: lhs.to_string(), symbol: symbol.to_string(), rhs: rhs.to_string() }
            }
            _ => {
                return Err(ParseError::at(
                    line,
                    "el lado derecho tiene demasiados términos — se esperaba 'símbolo estado' o solo 'estado'",
                ));
            }
        };

        if first_production_lhs.is_none() {
            first_production_lhs = Some(production.lhs().to_string());
        }
        productions.push(production);
    }

    if productions.is_empty() {
        return Err(ParseError::at(0, "la gramática no puede estar vacía"));
    }

    Ok(RegularGrammar { start: explicit_start.or(first_production_lhs), productions })
}

/// `parse`'s own matching inverse: renders `grammar` in the exact syntax
/// `parse` accepts (space-delimited, one production per line). Two things
/// `parse` can't recover from production lines alone, so `format` handles
/// them explicitly:
///  - **Which line comes first.** `parse` takes the first line's `lhs` as
///    the start symbol, but `grammar.productions` isn't guaranteed to
///    already be in that order (`fa_to_regular_grammar` sorts its output
///    for reproducibility, not start-first) — so `format` reorders,
///    stably, putting `grammar.start`'s own productions first.
///  - **A start symbol with no production of its own.** A state that is
///    initial but has neither an outgoing transition nor is accepting
///    never appears as any production's `lhs` at all — reordering has
///    nothing to move to the front. Without a way to say so, `parse` would
///    silently infer the wrong start symbol from whatever line ends up
///    first (an earlier version of this pair round-tripped a random
///    initial-but-dead-end state into an entirely different, wrong,
///    automaton before this was added — an `inicio: <label>` header line
///    is emitted only in that situation, so the common case stays exactly
///    the plain production list a student would write by hand).
pub fn format(grammar: &RegularGrammar) -> String {
    let mut out = String::new();
    let start_has_own_production =
        grammar.start.as_deref().is_some_and(|s| grammar.productions.iter().any(|p| p.lhs() == s));
    if let Some(start) = &grammar.start {
        if !start_has_own_production {
            out.push_str(&format!("inicio: {start}\n"));
        }
    }

    let mut ordered: Vec<&Production> = grammar.productions.iter().collect();
    if let Some(start) = &grammar.start {
        ordered.sort_by_key(|p| p.lhs() != start);
    }
    for p in ordered {
        match p {
            Production::Terminate { lhs } => out.push_str(&format!("{lhs} -> \u{03b5}\n")),
            Production::Derive { lhs, symbol, rhs } if symbol.is_empty() => {
                out.push_str(&format!("{lhs} -> {rhs}\n"))
            }
            Production::Derive { lhs, symbol, rhs } => out.push_str(&format!("{lhs} -> {symbol} {rhs}\n")),
        }
    }
    out
}

impl FromStr for RegularGrammar {
    type Err = ParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        parse(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_derive_production_with_a_symbol() {
        let g = parse("q0 -> a q1").unwrap();
        assert_eq!(g.start.as_deref(), Some("q0"));
        assert_eq!(
            g.productions,
            vec![Production::Derive { lhs: "q0".into(), symbol: "a".into(), rhs: "q1".into() }]
        );
    }

    #[test]
    fn parses_a_symbol_less_epsilon_labeled_derive() {
        let g = parse("q0 -> q1").unwrap();
        assert_eq!(
            g.productions,
            vec![Production::Derive { lhs: "q0".into(), symbol: String::new(), rhs: "q1".into() }]
        );
    }

    #[test]
    fn parses_a_terminating_production() {
        let g = parse("q1 -> ε").unwrap();
        assert_eq!(g.productions, vec![Production::Terminate { lhs: "q1".into() }]);
    }

    #[test]
    fn the_start_symbol_is_the_first_productions_lhs_not_alphabetically_first() {
        let g = parse("q9 -> a q0\nq0 -> ε").unwrap();
        assert_eq!(g.start.as_deref(), Some("q9"));
    }

    #[test]
    fn an_explicit_inicio_header_overrides_the_first_productions_lhs() {
        let g = parse("inicio: q0\nq9 -> a q0\nq0 -> ε").unwrap();
        assert_eq!(g.start.as_deref(), Some("q0"));
    }

    #[test]
    fn an_inicio_header_names_a_start_state_with_no_production_of_its_own() {
        // q0 is initial but has no outgoing transition and isn't accepting
        // — it never appears as a `lhs` anywhere, so only the header can
        // say it's the start.
        let g = parse("inicio: q0\nq1 -> ε").unwrap();
        assert_eq!(g.start.as_deref(), Some("q0"));
        assert_eq!(g.productions, vec![Production::Terminate { lhs: "q1".into() }]);
    }

    #[test]
    fn rejects_an_inicio_header_with_no_state_name() {
        let err = parse("inicio:\nq0 -> ε").unwrap_err();
        assert!(err.message.contains("inicio"));
    }

    #[test]
    fn rejects_a_second_inicio_header() {
        let err = parse("inicio: q0\ninicio: q1\nq0 -> ε").unwrap_err();
        assert!(err.message.contains("solo puede haber un"));
    }

    #[test]
    fn ignores_blank_lines_and_surrounding_whitespace() {
        let g = parse("\n  q0 -> a q1  \n\n  q1 -> ε\n").unwrap();
        assert_eq!(g.productions.len(), 2);
    }

    #[test]
    fn supports_multi_character_non_terminal_names() {
        let g = parse("q0 -> a q123").unwrap();
        assert_eq!(
            g.productions,
            vec![Production::Derive { lhs: "q0".into(), symbol: "a".into(), rhs: "q123".into() }]
        );
    }

    #[test]
    fn rejects_empty_input() {
        assert!(parse("").is_err());
        assert!(parse("   \n  \n").is_err());
    }

    #[test]
    fn rejects_a_line_with_no_arrow() {
        let err = parse("q0 q1").unwrap_err();
        assert!(err.message.contains("'->'"));
        assert_eq!(err.line, 1);
    }

    #[test]
    fn rejects_a_missing_left_hand_side() {
        let err = parse("-> a q1").unwrap_err();
        assert!(err.message.contains("lado izquierdo"));
    }

    #[test]
    fn rejects_a_missing_right_hand_side() {
        let err = parse("q0 ->").unwrap_err();
        assert!(err.message.contains("lado derecho"));
    }

    #[test]
    fn rejects_a_multi_character_symbol() {
        let err = parse("q0 -> ab q1").unwrap_err();
        assert!(err.message.contains("un solo carácter"));
    }

    #[test]
    fn rejects_too_many_right_hand_side_terms() {
        let err = parse("q0 -> a q1 q2").unwrap_err();
        assert!(err.message.contains("demasiados términos"));
    }

    #[test]
    fn reports_the_1_indexed_line_of_the_failing_production() {
        let err = parse("q0 -> a q1\nq1 ->\n").unwrap_err();
        assert_eq!(err.line, 2);
    }

    #[test]
    fn format_puts_the_start_symbols_productions_first_regardless_of_input_order() {
        let grammar = RegularGrammar {
            start: Some("q1".into()),
            productions: vec![
                Production::Terminate { lhs: "q0".into() },
                Production::Derive { lhs: "q1".into(), symbol: "a".into(), rhs: "q0".into() },
            ],
        };
        let text = format(&grammar);
        assert!(text.starts_with("q1 -> a q0"));
    }

    #[test]
    fn format_omits_the_inicio_header_when_the_start_has_its_own_production() {
        let grammar = RegularGrammar {
            start: Some("q0".into()),
            productions: vec![Production::Derive { lhs: "q0".into(), symbol: "a".into(), rhs: "q1".into() }],
        };
        assert!(!format(&grammar).contains("inicio:"));
    }

    #[test]
    fn format_emits_an_inicio_header_when_the_start_has_no_production_of_its_own() {
        let grammar = RegularGrammar {
            start: Some("q0".into()),
            productions: vec![Production::Terminate { lhs: "q1".into() }],
        };
        let text = format(&grammar);
        assert!(text.starts_with("inicio: q0\n"));
        let reparsed = parse(&text).unwrap();
        assert_eq!(reparsed.start.as_deref(), Some("q0"));
    }

    #[test]
    fn format_and_parse_round_trip_a_single_production() {
        let g = parse("q0 -> a q1").unwrap();
        let reparsed = parse(&format(&g)).unwrap();
        assert_eq!(g, reparsed);
    }

    /// `format` is `parse`'s designed inverse — `parse(&format(g))` must
    /// reconstruct an equivalent automaton for every grammar
    /// `fa_to_regular_grammar` can actually produce from a random automaton
    /// **that has an initial state** (mirrors `regex::parser`'s own
    /// round-trip proptest one level over). Automata with no initial state
    /// are excluded on purpose: `fa_to_regular_grammar` still emits their
    /// productions with `start: None`, but a typed grammar always implies
    /// SOME start symbol (the first line's `lhs`) — there is no "∅"-style
    /// sentinel for "no start" the way `regex::Regex::Empty` covers "no
    /// initial state" for regexes. That gap is a documented, narrow
    /// limitation, not a silently-wrong round trip.
    mod round_trip_preserves_language_of_random_grammars {
        use super::*;
        use crate::convert::fa_to_grammar::fa_to_regular_grammar;
        use crate::convert::regular_grammar_to_nfa;
        use crate::engine::{run_bounded, Budget, Outcome};
        use crate::ids::SymbolId;
        use crate::model::fa::FaDoc;
        use proptest::prelude::*;

        #[derive(Debug, Clone, Copy)]
        enum EdgeKind {
            Eps,
            A,
            B,
        }

        fn build_random_nfa(n: usize, edges: &[(usize, usize, EdgeKind)], initial: usize, accepting: &[usize]) -> FaDoc {
            let mut doc = FaDoc::new();
            let ids: Vec<_> = (0..n).map(|i| doc.add_state(&format!("q{i}"), 0.0, 0.0).unwrap()).collect();
            doc.set_initial(Some(ids[initial % n]));
            for &a in accepting {
                doc.set_accepting(ids[a % n], true);
            }
            for &(from, to, kind) in edges {
                let (f, t) = (ids[from % n], ids[to % n]);
                match kind {
                    EdgeKind::Eps => doc.add_epsilon_transition(f, t),
                    EdgeKind::A => {
                        doc.add_transition(f, t, "a");
                    }
                    EdgeKind::B => {
                        doc.add_transition(f, t, "b");
                    }
                }
            }
            doc
        }

        fn accepts(doc: &FaDoc, w: &str) -> bool {
            let engine = crate::engine::fa::FaEngine::compile(doc);
            let input: Vec<SymbolId> = w
                .chars()
                .map(|c| doc.symbol_label_to_id(&c.to_string()).unwrap_or(SymbolId(u32::MAX)))
                .collect();
            run_bounded(&engine, &input, Budget::default()).outcome == Outcome::Accepted
        }

        fn edge_kind_strategy() -> impl Strategy<Value = EdgeKind> {
            prop_oneof![Just(EdgeKind::Eps), Just(EdgeKind::A), Just(EdgeKind::B)]
        }

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(256))]

            #[test]
            fn matches(
                n in 2usize..6,
                edges in prop::collection::vec((0usize..6, 0usize..6, edge_kind_strategy()), 0..10),
                initial in 0usize..6,
                accepting in prop::collection::vec(0usize..6, 0..3),
                words in prop::collection::vec("[ab]{0,5}", 0..15),
            ) {
                let original = build_random_nfa(n, &edges, initial, &accepting);
                let grammar = fa_to_regular_grammar(&original);
                // No edges and no accepting states -> no productions at all
                // (`fa_to_regular_grammar` only emits one per edge/accepting
                // state, never a bare "state exists" production) — an empty
                // grammar has no text `parse` can express (same "no
                // sentinel for nothing" gap as the no-initial-state case
                // this module's doc comment already calls out), so there is
                // nothing to round-trip; skip rather than weaken `parse`.
                prop_assume!(!grammar.productions.is_empty());
                let text = format(&grammar);
                let reparsed = parse(&text).unwrap_or_else(|e| panic!("failed to re-parse formatted grammar {text:?}: {e}"));
                let rebuilt = regular_grammar_to_nfa(&reparsed);
                for w in &words {
                    prop_assert_eq!(accepts(&original, w), accepts(&rebuilt, w), "mismatch on word {:?} for grammar:\n{}", w, text);
                }
            }
        }
    }
}
