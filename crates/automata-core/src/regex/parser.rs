//! Hand-written recursive-descent parser for the regex text syntax —
//! deliberately the exact inverse of `Display` (`../mod.rs`'s
//! `fmt_prec`/`impl Display for Regex`): `+` for union (loosest), plain
//! juxtaposition for concatenation, `*` for postfix Kleene star (tightest),
//! parens for grouping, `ε`/`∅` as the epsilon/empty-language literals.
//! Every other non-reserved, non-whitespace character is its own
//! one-character `Symbol` — regex syntax over a single-character alphabet,
//! same convention JFLAP itself uses. That restriction isn't arbitrary:
//! `Display` prints concatenated symbols with no delimiter between them
//! (`Regex::Symbol("00")` next to `Regex::Symbol("1")` prints `001`,
//! indistinguishable from three one-character symbols `0`, `0`, `1`), so a
//! multi-character symbol token would make parsing ambiguous. Single
//! characters are the only tokenization that keeps `s.parse::<Regex>()`
//! and `regex.to_string()` genuine inverses of each other.
//!
//! Error messages are user-facing Spanish text, not developer-facing
//! English — unlike every other error type in this crate, this one is
//! meant to be shown verbatim in the frontend the moment a student mistypes
//! a regex (`conv_from_regex`, `src-tauri/src/commands/convert.rs`), the
//! same way `TableView.js`'s own validation notices are.

use std::str::FromStr;

use super::Regex;

const EPSILON: char = '\u{03b5}'; // ε
const EMPTY: char = '\u{2205}'; // ∅

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message} (posición {position})")]
pub struct ParseError {
    pub message: String,
    /// Character index (not byte offset) into the original input.
    pub position: usize,
}

impl ParseError {
    fn at(position: usize, message: impl Into<String>) -> Self {
        ParseError { message: message.into(), position }
    }
}

struct Parser {
    chars: Vec<char>,
    pos: usize,
}

impl Parser {
    fn new(input: &str) -> Self {
        Parser { chars: input.chars().collect(), pos: 0 }
    }

    fn skip_whitespace(&mut self) {
        while self.chars.get(self.pos).is_some_and(|c| c.is_whitespace()) {
            self.pos += 1;
        }
    }

    /// Next non-whitespace char without consuming it.
    fn peek(&mut self) -> Option<char> {
        self.skip_whitespace();
        self.chars.get(self.pos).copied()
    }

    fn advance(&mut self) {
        self.pos += 1;
    }

    /// Union binds loosest: one or more `concat` terms separated by `+`.
    fn union(&mut self) -> Result<Regex, ParseError> {
        let mut left = self.concat()?;
        while self.peek() == Some('+') {
            self.advance();
            let right = self.concat()?;
            left = left.union(right);
        }
        Ok(left)
    }

    /// Concatenation: one or more `star` terms with nothing between them —
    /// stops at `+`, `)`, or end of input, since those can't start a term.
    fn concat(&mut self) -> Result<Regex, ParseError> {
        let mut left = self.star()?;
        while let Some(c) = self.peek() {
            if c == '+' || c == ')' {
                break;
            }
            let right = self.star()?;
            left = left.concat(right);
        }
        Ok(left)
    }

    /// Star binds tightest: one atom followed by zero or more `*` (`a**` is
    /// harmless — `Regex::star` is already idempotent).
    fn star(&mut self) -> Result<Regex, ParseError> {
        let mut r = self.atom()?;
        while self.peek() == Some('*') {
            self.advance();
            r = r.star();
        }
        Ok(r)
    }

    fn atom(&mut self) -> Result<Regex, ParseError> {
        let pos = { self.skip_whitespace(); self.pos };
        match self.peek() {
            None => Err(ParseError::at(pos, "se esperaba un símbolo, '(', 'ε' o '∅'")),
            Some('(') => {
                self.advance();
                let inner = self.union()?;
                self.skip_whitespace();
                if self.peek() == Some(')') {
                    self.advance();
                    Ok(inner)
                } else {
                    Err(ParseError::at(self.pos, "falta ')' para cerrar el grupo"))
                }
            }
            Some(')') => Err(ParseError::at(pos, "')' inesperado — no hay ningún '(' abierto")),
            Some('*') => {
                Err(ParseError::at(pos, "'*' inesperado — falta el símbolo o grupo al que aplica"))
            }
            Some('+') => Err(ParseError::at(pos, "'+' inesperado — falta el término anterior")),
            Some(c) if c == EPSILON => {
                self.advance();
                Ok(Regex::Epsilon)
            }
            Some(c) if c == EMPTY => {
                self.advance();
                Ok(Regex::Empty)
            }
            Some(c) => {
                self.advance();
                Ok(Regex::Symbol(c.to_string()))
            }
        }
    }
}

/// Parse `input` as a regular expression. Whitespace anywhere is
/// insignificant. An input that is empty (or only whitespace) is rejected
/// rather than silently treated as some default — `ε` and `∅` are both one
/// keystroke away and unambiguous about which language they mean.
pub fn parse(input: &str) -> Result<Regex, ParseError> {
    if input.trim().is_empty() {
        return Err(ParseError::at(
            0,
            "la expresión no puede estar vacía — usá 'ε' para el lenguaje {ε} o '∅' para el lenguaje vacío",
        ));
    }
    let mut parser = Parser::new(input);
    let result = parser.union()?;
    parser.skip_whitespace();
    if let Some(c) = parser.peek() {
        return Err(ParseError::at(parser.pos, format!("carácter inesperado '{c}'")));
    }
    Ok(result)
}

impl FromStr for Regex {
    type Err = ParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        parse(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sym(s: &str) -> Regex {
        Regex::Symbol(s.to_string())
    }

    #[test]
    fn parses_a_bare_symbol() {
        assert_eq!(parse("a"), Ok(sym("a")));
    }

    #[test]
    fn parses_epsilon_and_empty_literals() {
        assert_eq!(parse("ε"), Ok(Regex::Epsilon));
        assert_eq!(parse("∅"), Ok(Regex::Empty));
    }

    #[test]
    fn parses_concatenation_by_juxtaposition() {
        assert_eq!(parse("ab"), Ok(sym("a").concat(sym("b"))));
    }

    #[test]
    fn parses_union() {
        assert_eq!(parse("a+b"), Ok(sym("a").union(sym("b"))));
    }

    #[test]
    fn parses_star() {
        assert_eq!(parse("a*"), Ok(sym("a").star()));
    }

    #[test]
    fn star_binds_tighter_than_concatenation() {
        // ab* means a(b*), not (ab)*.
        assert_eq!(parse("ab*"), Ok(sym("a").concat(sym("b").star())));
    }

    #[test]
    fn concatenation_binds_tighter_than_union() {
        // a+bc means a+(bc), not (a+b)c.
        assert_eq!(parse("a+bc"), Ok(sym("a").union(sym("b").concat(sym("c")))));
    }

    #[test]
    fn parens_override_precedence() {
        assert_eq!(parse("(a+b)*"), Ok(sym("a").union(sym("b")).star()));
        assert_eq!(parse("(a+b)c"), Ok(sym("a").union(sym("b")).concat(sym("c"))));
    }

    #[test]
    fn ignores_whitespace_anywhere() {
        assert_eq!(parse("  a  +  b * c  "), parse("a+b*c"));
    }

    #[test]
    fn double_star_is_harmless() {
        assert_eq!(parse("a**"), Ok(sym("a").star()));
    }

    #[test]
    fn rejects_empty_input() {
        assert!(parse("").is_err());
        assert!(parse("   ").is_err());
    }

    #[test]
    fn rejects_unclosed_paren() {
        let err = parse("(a+b").unwrap_err();
        assert!(err.message.contains("falta ')'"));
    }

    #[test]
    fn rejects_a_trailing_unopened_paren() {
        // "a)" — `concat`/`union` correctly stop right before the stray
        // ')' (same as they would at end of input), so it's `parse`'s
        // trailing-input check that reports it, not `atom`'s own
        // "')' inesperado" branch (that one fires when a ')' appears where
        // a *term* was expected instead, e.g. "()").
        let err = parse("a)").unwrap_err();
        assert!(err.message.contains("carácter inesperado"));
    }

    #[test]
    fn rejects_a_paren_with_no_term_inside() {
        let err = parse("()").unwrap_err();
        assert!(err.message.contains("')' inesperado"));
    }

    #[test]
    fn rejects_a_leading_star() {
        let err = parse("*a").unwrap_err();
        assert!(err.message.contains("'*' inesperado"));
    }

    #[test]
    fn rejects_a_leading_plus() {
        let err = parse("+a").unwrap_err();
        assert!(err.message.contains("'+' inesperado"));
    }

    #[test]
    fn rejects_a_trailing_plus() {
        assert!(parse("a+").is_err());
    }

    #[test]
    fn reports_a_0_indexed_character_position_not_a_byte_offset() {
        // 'ε' is multi-byte in UTF-8 but must still count as one character.
        let err = parse("εb)").unwrap_err();
        assert_eq!(err.position, 2);
    }

    /// `parse` and `Display` must be genuine inverses of each other
    /// (semantically — parenthesization/associativity may differ) for
    /// every regex `Display` can actually produce, since that's the whole
    /// point of this parser: `RegexView` shows `fa_to_regex(...).to_string()`
    /// and the planned regex-input path feeds user text back through
    /// `parse`. Mirrors `fa_to_regex::tests::round_trip_preserves_language_of_random_nfas`'s
    /// build-random-NFA-then-compare-by-language shape, one level removed
    /// (random `Regex` AST -> text -> re-parsed AST, instead of random NFA
    /// -> regex).
    mod round_trip_preserves_language_of_random_regexes {
        use super::*;
        use crate::convert::regex_to_nfa::regex_to_nfa;
        use crate::engine::{run_bounded, Budget, Outcome};
        use crate::ids::SymbolId;
        use crate::model::fa::FaDoc;
        use proptest::prelude::*;

        fn accepts(doc: &FaDoc, w: &str) -> bool {
            let engine = crate::engine::fa::FaEngine::compile(doc);
            let input: Vec<SymbolId> = w
                .chars()
                .map(|c| doc.symbol_label_to_id(&c.to_string()).unwrap_or(SymbolId(u32::MAX)))
                .collect();
            run_bounded(&engine, &input, Budget::default()).outcome == Outcome::Accepted
        }

        fn regex_strategy() -> impl Strategy<Value = Regex> {
            let leaf = prop_oneof![
                Just(Regex::Empty),
                Just(Regex::Epsilon),
                "[ab]".prop_map(|s| Regex::Symbol(s)),
            ];
            leaf.prop_recursive(4, 16, 3, |inner| {
                prop_oneof![
                    (inner.clone(), inner.clone()).prop_map(|(a, b)| a.concat(b)),
                    (inner.clone(), inner.clone()).prop_map(|(a, b)| a.union(b)),
                    inner.prop_map(|a| a.star()),
                ]
            })
        }

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(256))]

            #[test]
            fn matches(r in regex_strategy(), words in prop::collection::vec("[ab]{0,5}", 0..15)) {
                let text = r.to_string();
                let reparsed = parse(&text).unwrap_or_else(|e| panic!("failed to re-parse Display output {text:?}: {e}"));
                let original_doc = regex_to_nfa(&r);
                let reparsed_doc = regex_to_nfa(&reparsed);
                for w in &words {
                    prop_assert_eq!(
                        accepts(&original_doc, w),
                        accepts(&reparsed_doc, w),
                        "mismatch on word {:?} for regex {:?}", w, text
                    );
                }
            }
        }
    }
}
