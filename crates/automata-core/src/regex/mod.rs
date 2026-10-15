//! Regular expression AST — what `convert::fa_to_regex` produces and
//! `convert::regex_to_nfa` consumes.
//!
//! Text syntax (the course's notation, `idea/nuevos_agregados/ER a AFD.pdf`):
//! `|` union, juxtaposition concatenation, postfix `*` (zero or more), `+`
//! (one or more) and `?` (zero or one). JFLAP itself writes union as `+`;
//! this app does not, so `+` is free to mean the positive closure.
//!
//! JFLAP's own `FSAToRegularExpressionConverter` builds regexes as raw
//! strings, tracking precedence by *scanning the string* for a bare `+`
//! (`needsParens`) to decide whether to wrap it. That works but is fragile
//! by construction. An AST makes correct minimal parenthesization a
//! structural property of `Display` instead of a string-inspection heuristic
//! — see `precedence`/`fmt_prec` below.

use std::fmt;

pub mod parser;
pub use parser::{parse, ParseError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Regex {
    /// Matches nothing — the empty language, `∅`. Not part of classic regex
    /// syntax, but a natural intermediate value during GNFA state
    /// elimination (`convert::fa_to_regex`) whenever a symbol has no path at
    /// all between two states.
    Empty,
    /// Matches only the empty string, `ε`.
    Epsilon,
    Symbol(String),
    Concat(Box<Regex>, Box<Regex>),
    Union(Box<Regex>, Box<Regex>),
    Star(Box<Regex>),
    /// One or more repetitions, `r+` (positive closure).
    Plus(Box<Regex>),
    /// Zero or one occurrence, `r?`.
    Optional(Box<Regex>),
}

impl Regex {
    /// Smart constructors apply the same algebraic simplifications JFLAP's
    /// own `concatenate`/`or`/`star` string helpers do (`∅` absorbs, `ε` is
    /// concat's identity) — not full canonicalization, just enough to avoid
    /// the most obvious bloat, same level of effort as the original.
    pub fn concat(self, other: Regex) -> Regex {
        match (&self, &other) {
            (Regex::Empty, _) | (_, Regex::Empty) => Regex::Empty,
            (Regex::Epsilon, _) => other,
            (_, Regex::Epsilon) => self,
            _ => Regex::Concat(Box::new(self), Box::new(other)),
        }
    }

    pub fn union(self, other: Regex) -> Regex {
        match (&self, &other) {
            (Regex::Empty, _) => other,
            (_, Regex::Empty) => self,
            _ if self == other => self,
            _ => Regex::Union(Box::new(self), Box::new(other)),
        }
    }

    pub fn star(self) -> Regex {
        match self {
            Regex::Empty | Regex::Epsilon => Regex::Epsilon,
            Regex::Star(_) => self,
            Regex::Plus(inner) | Regex::Optional(inner) => inner.star(),
            _ => Regex::Star(Box::new(self)),
        }
    }

    pub fn plus(self) -> Regex {
        match self {
            Regex::Empty | Regex::Epsilon | Regex::Star(_) | Regex::Plus(_) => self,
            _ => Regex::Plus(Box::new(self)),
        }
    }

    pub fn optional(self) -> Regex {
        match self {
            Regex::Empty | Regex::Epsilon => Regex::Epsilon,
            Regex::Star(_) | Regex::Optional(_) => self,
            // ε or one-or-more r is exactly r*.
            Regex::Plus(inner) => inner.star(),
            _ => Regex::Optional(Box::new(self)),
        }
    }
}

/// Union binds loosest, then concat, then the postfix operators (`*`, `+`,
/// `?`); leaves never need parens.
/// Higher number = binds tighter.
fn precedence(r: &Regex) -> u8 {
    match r {
        Regex::Union(..) => 0,
        Regex::Concat(..) => 1,
        Regex::Star(..) | Regex::Plus(..) | Regex::Optional(..) => 2,
        Regex::Empty | Regex::Epsilon | Regex::Symbol(_) => 3,
    }
}

/// Print `r` as it appears directly under an operator that requires its
/// operands to bind at least as tightly as `required` — wrapping in parens
/// only when that's not already true.
fn fmt_prec(r: &Regex, required: u8, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    let wrap = precedence(r) < required;
    if wrap {
        write!(f, "(")?;
    }
    match r {
        Regex::Empty => write!(f, "\u{2205}")?,
        Regex::Epsilon => write!(f, "\u{03b5}")?,
        Regex::Symbol(s) => write!(f, "{s}")?,
        Regex::Union(a, b) => {
            fmt_prec(a, 0, f)?;
            write!(f, "|")?;
            fmt_prec(b, 0, f)?;
        }
        Regex::Concat(a, b) => {
            fmt_prec(a, 1, f)?;
            fmt_prec(b, 1, f)?;
        }
        Regex::Star(a) => {
            fmt_prec(a, 2, f)?;
            write!(f, "*")?;
        }
        Regex::Plus(a) => {
            fmt_prec(a, 2, f)?;
            write!(f, "+")?;
        }
        Regex::Optional(a) => {
            fmt_prec(a, 2, f)?;
            write!(f, "?")?;
        }
    }
    if wrap {
        write!(f, ")")?;
    }
    Ok(())
}

impl fmt::Display for Regex {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt_prec(self, 0, f)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sym(s: &str) -> Regex {
        Regex::Symbol(s.to_string())
    }

    #[test]
    fn concat_of_a_union_gets_parens_but_union_of_concats_does_not() {
        let union_ab = sym("a").union(sym("b"));
        let concat_with_union = union_ab.clone().concat(sym("c"));
        assert_eq!(concat_with_union.to_string(), "(a|b)c");

        let concat_ab = sym("a").concat(sym("b"));
        let union_of_concats = concat_ab.clone().union(sym("c").concat(sym("d")));
        assert_eq!(union_of_concats.to_string(), "ab|cd");
    }

    #[test]
    fn star_wraps_concat_and_union_but_not_a_bare_symbol() {
        assert_eq!(sym("a").star().to_string(), "a*");
        assert_eq!(sym("a").concat(sym("b")).star().to_string(), "(ab)*");
        assert_eq!(sym("a").union(sym("b")).star().to_string(), "(a|b)*");
    }

    #[test]
    fn plus_and_optional_are_postfix_like_star() {
        assert_eq!(sym("a").plus().to_string(), "a+");
        assert_eq!(sym("a").optional().to_string(), "a?");
        assert_eq!(sym("a").concat(sym("b")).plus().to_string(), "(ab)+");
        assert_eq!(sym("a").union(sym("b")).optional().to_string(), "(a|b)?");
        assert_eq!(sym("a").optional().concat(sym("b")).to_string(), "a?b");
    }

    #[test]
    fn plus_and_optional_simplify_like_star() {
        assert_eq!(Regex::Empty.plus(), Regex::Empty);
        assert_eq!(Regex::Epsilon.plus(), Regex::Epsilon);
        assert_eq!(sym("a").star().plus(), sym("a").star());
        assert_eq!(sym("a").plus().plus(), sym("a").plus());
        assert_eq!(Regex::Empty.optional(), Regex::Epsilon);
        assert_eq!(Regex::Epsilon.optional(), Regex::Epsilon);
        assert_eq!(sym("a").star().optional(), sym("a").star());
        assert_eq!(sym("a").optional().optional(), sym("a").optional());
        // (r+)? accepts ε plus one-or-more r: exactly r*.
        assert_eq!(sym("a").plus().optional(), sym("a").star());
    }

    #[test]
    fn smart_constructors_absorb_empty_and_epsilon() {
        assert_eq!(sym("a").concat(Regex::Empty), Regex::Empty);
        assert_eq!(sym("a").concat(Regex::Epsilon), sym("a"));
        assert_eq!(Regex::Epsilon.concat(sym("a")), sym("a"));
        assert_eq!(sym("a").union(Regex::Empty), sym("a"));
        assert_eq!(Regex::Empty.star(), Regex::Epsilon);
        assert_eq!(Regex::Epsilon.star(), Regex::Epsilon);
        assert_eq!(sym("a").star().star(), sym("a").star());
    }
}
