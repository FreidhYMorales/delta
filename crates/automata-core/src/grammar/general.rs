//! General (unrestricted) grammars, G = {Σ, N, S, P}: any production
//! `α → β` whose left side contains at least one non-terminal — the model
//! the "Gramática" tab works on (`idea/nuevos_agregados/GRAMÁTICAS.pdf`,
//! `Jerarquía de Chomsky.pdf`). Unlike `super::RegularGrammar` (right-linear
//! only, the FA <-> grammar conversion's model), this accepts every level of
//! the Chomsky hierarchy, e.g. `aaA -> aaBB` or `0S1 -> 01`.
//!
//! Text syntax, one production per line, as the course writes it:
//! - Arrow: `->`, `→`, `–>`, `—>` or `::=`. Alternatives with `|`.
//! - Non-terminals: an uppercase letter, or a name in angle brackets
//!   (`<expresión>`). Terminals: any other single character, or a quoted
//!   multi-character word (`'if'`, `"then"`).
//! - Empty string: `ε`, `λ`, `∈`, `Є`, `ϵ` or an empty right side.
//! - Optional declarations: `Σ = {a, b}` (also `∑` or `T`), `N = {S, A}`,
//!   `S = S` (start symbol). Without them, Σ and N are inferred and the
//!   start symbol is `S` when it appears, else the first production's left
//!   side. A symbol used but not declared is a warning, not an error — the
//!   course's own examples do it.
//! - Blank lines, `G:`/`P =` headers and `//` comments are ignored.
//!
//! Error and warning messages are user-facing Spanish, shown verbatim.

use std::fmt;

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(tag = "kind", content = "name", rename_all = "lowercase")]
pub enum Symbol {
    Terminal(String),
    NonTerminal(String),
}

impl Symbol {
    pub fn is_nonterminal(&self) -> bool {
        matches!(self, Symbol::NonTerminal(_))
    }

    pub fn name(&self) -> &str {
        match self {
            Symbol::Terminal(s) | Symbol::NonTerminal(s) => s,
        }
    }
}

impl fmt::Display for Symbol {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Symbol::NonTerminal(n) if n.chars().count() > 1 => write!(f, "<{n}>"),
            Symbol::Terminal(t) if t.chars().count() > 1 => write!(f, "'{t}'"),
            other => write!(f, "{}", other.name()),
        }
    }
}

/// A sentential form (sequence of symbols) as text, `ε` when empty.
pub fn form_text(symbols: &[Symbol]) -> String {
    if symbols.is_empty() {
        "ε".to_string()
    } else {
        symbols.iter().map(Symbol::to_string).collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GeneralProduction {
    pub lhs: Vec<Symbol>,
    pub rhs: Vec<Symbol>,
    /// 1-based source line, for error messages and highlighting.
    pub line: usize,
}

impl fmt::Display for GeneralProduction {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} → {}", form_text(&self.lhs), form_text(&self.rhs))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GeneralGrammar {
    pub terminals: Vec<String>,
    pub nonterminals: Vec<String>,
    pub start: String,
    pub productions: Vec<GeneralProduction>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("línea {line}: {message}")]
pub struct GrammarError {
    pub line: usize,
    pub message: String,
}

const ARROWS: [&str; 5] = ["::=", "->", "→", "–>", "—>"];
const EPSILONS: [char; 5] = ['ε', 'λ', '∈', 'Є', 'ϵ'];

fn error(line: usize, message: impl Into<String>) -> GrammarError {
    GrammarError { line, message: message.into() }
}

pub fn parse_general(text: &str) -> Result<GeneralGrammar, GrammarError> {
    let mut declared_terminals: Option<Vec<String>> = None;
    let mut declared_nonterminals: Option<Vec<String>> = None;
    let mut declared_start: Option<String> = None;
    let mut raw: Vec<(usize, &str, &str)> = Vec::new();

    for (index, source_line) in text.lines().enumerate() {
        let line_no = index + 1;
        let line = source_line.split("//").next().unwrap_or("").trim();
        if line.is_empty() || is_header(line) {
            continue;
        }
        if let Some((at, len)) = find_arrow(line) {
            raw.push((line_no, &line[..at], &line[at + len..]));
        } else if let Some((name, value)) = declaration(line) {
            match name {
                'N' => declared_nonterminals = Some(set_items(value)),
                'S' => declared_start = Some(strip_brackets(value.trim()).to_string()),
                _ => declared_terminals = Some(set_items(value)),
            }
        } else {
            return Err(error(line_no, format!("falta la flecha '->' entre los dos lados de la producción: «{line}»")));
        }
    }
    if raw.is_empty() {
        return Err(error(1, "la gramática no tiene producciones — escribí una por línea, p. ej. S -> aS | b"));
    }

    let declared_n: Vec<String> = declared_nonterminals.clone().unwrap_or_default();
    let mut productions = Vec::new();
    for (line, lhs_text, rhs_text) in raw {
        let lhs = tokenize(lhs_text, &declared_n).map_err(|m| error(line, m))?;
        if !lhs.iter().any(Symbol::is_nonterminal) {
            return Err(error(
                line,
                format!("el lado izquierdo «{}» debe tener al menos un no terminal", lhs_text.trim()),
            ));
        }
        for alternative in split_alternatives(rhs_text) {
            let rhs = tokenize(alternative, &declared_n).map_err(|m| error(line, m))?;
            productions.push(GeneralProduction { lhs: lhs.clone(), rhs, line });
        }
    }

    // Symbols in order of first appearance, after any declared ones.
    let mut used_terminals = Vec::new();
    let mut used_nonterminals = Vec::new();
    for symbol in productions.iter().flat_map(|p| p.lhs.iter().chain(&p.rhs)) {
        let list = if symbol.is_nonterminal() { &mut used_nonterminals } else { &mut used_terminals };
        if !list.iter().any(|s: &String| s == symbol.name()) {
            list.push(symbol.name().to_string());
        }
    }
    let mut warnings = Vec::new();
    let terminals = merge_declared(declared_terminals, used_terminals, "terminal", "Σ", &mut warnings);
    let nonterminals = merge_declared(declared_nonterminals, used_nonterminals, "no terminal", "N", &mut warnings);

    let start = match declared_start {
        Some(start) => {
            if !nonterminals.contains(&start) {
                warnings.push(format!("el símbolo inicial '{start}' no aparece en ninguna producción"));
            }
            start
        }
        None if nonterminals.iter().any(|n| n == "S") => "S".to_string(),
        None => productions[0]
            .lhs
            .iter()
            .find(|s| s.is_nonterminal())
            .map(|s| s.name().to_string())
            .expect("every left side has a non-terminal"),
    };

    Ok(GeneralGrammar { terminals, nonterminals, start, productions, warnings })
}

/// `G:`, `P =`, `P:` and similar section headers carry no information.
fn is_header(line: &str) -> bool {
    let compact: String = line.chars().filter(|c| !c.is_whitespace()).collect();
    matches!(compact.as_str(), "G:" | "G" | "P=" | "P:" | "P")
}

/// Earliest arrow in `line` as (byte offset, byte length).
fn find_arrow(line: &str) -> Option<(usize, usize)> {
    ARROWS.iter().filter_map(|a| line.find(a).map(|at| (at, a.len()))).min_by_key(|&(at, len)| (at, usize::MAX - len))
}

/// `Σ = {…}` / `∑ = {…}` / `T = {…}` (terminals), `N = {…}`, `S = X`.
fn declaration(line: &str) -> Option<(char, &str)> {
    let mut chars = line.chars();
    let name = chars.next()?;
    let rest = chars.as_str().trim_start();
    let value = rest.strip_prefix('=')?;
    match name {
        'Σ' | '∑' | 'T' => Some(('T', value)),
        'N' | 'S' => Some((name, value)),
        _ => None,
    }
}

fn strip_brackets(item: &str) -> &str {
    let item = item.trim();
    item.strip_prefix('<')
        .and_then(|i| i.strip_suffix('>'))
        .or_else(|| item.strip_prefix('\'').and_then(|i| i.strip_suffix('\'')))
        .or_else(|| item.strip_prefix('"').and_then(|i| i.strip_suffix('"')))
        .unwrap_or(item)
}

/// `{ a, b, c }` -> ["a", "b", "c"].
fn set_items(value: &str) -> Vec<String> {
    value
        .trim()
        .trim_start_matches('{')
        .trim_end_matches('}')
        .split(',')
        .map(strip_brackets)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect()
}

/// Splits a right side on top-level `|` (not inside quotes or `<…>`).
fn split_alternatives(rhs: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut quote: Option<char> = None;
    let mut in_name = false;
    for (i, c) in rhs.char_indices() {
        match (c, quote, in_name) {
            ('\'' | '"', None, false) => quote = Some(c),
            (q, Some(open), _) if q == open => quote = None,
            ('<', None, false) => in_name = true,
            ('>', None, true) => in_name = false,
            ('|', None, false) => {
                parts.push(&rhs[start..i]);
                start = i + c.len_utf8();
            }
            _ => {}
        }
    }
    parts.push(&rhs[start..]);
    parts
}

/// One side of a production as symbols. ε (in any spelling) is the empty
/// string, so it simply contributes no symbol.
fn tokenize(side: &str, declared_nonterminals: &[String]) -> Result<Vec<Symbol>, String> {
    let mut symbols = Vec::new();
    let mut chars = side.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            c if c.is_whitespace() || EPSILONS.contains(&c) => {}
            '<' => {
                let name: String = chars.by_ref().take_while(|&c| c != '>').collect();
                if name.trim().is_empty() {
                    return Err("'<…>' necesita un nombre de no terminal adentro, p. ej. <expresión>".into());
                }
                symbols.push(Symbol::NonTerminal(name.trim().to_string()));
            }
            '\'' | '"' => {
                let word: String = chars.by_ref().take_while(|&q| q != c).collect();
                if word.is_empty() {
                    return Err(format!("un terminal entre comillas no puede estar vacío: {c}{c}"));
                }
                symbols.push(Symbol::Terminal(word));
            }
            c if c.is_uppercase() || declared_nonterminals.iter().any(|n| *n == c.to_string()) => {
                symbols.push(Symbol::NonTerminal(c.to_string()));
            }
            c => symbols.push(Symbol::Terminal(c.to_string())),
        }
    }
    Ok(symbols)
}

/// Declared symbols first (in their order), then any used-but-undeclared
/// ones, each of which also produces a warning.
fn merge_declared(
    declared: Option<Vec<String>>,
    used: Vec<String>,
    what: &str,
    set_name: &str,
    warnings: &mut Vec<String>,
) -> Vec<String> {
    let Some(mut all) = declared else { return used };
    for symbol in used {
        if !all.contains(&symbol) {
            warnings.push(format!("el {what} '{symbol}' se usa pero no está declarado en {set_name}"));
            all.push(symbol);
        }
    }
    all
}

#[cfg(test)]
mod tests {
    use super::*;

    fn productions(g: &GeneralGrammar) -> Vec<String> {
        g.productions.iter().map(|p| p.to_string()).collect()
    }

    #[test]
    fn parses_productions_with_alternatives_and_infers_sigma_n_and_s() {
        let g = parse_general("S -> aS | aA\nA -> bA | b").unwrap();
        assert_eq!(productions(&g), vec!["S → aS", "S → aA", "A → bA", "A → b"]);
        assert_eq!(g.terminals, vec!["a", "b"]);
        assert_eq!(g.nonterminals, vec!["S", "A"]);
        assert_eq!(g.start, "S");
        assert!(g.warnings.is_empty());
    }

    #[test]
    fn accepts_every_arrow_and_epsilon_spelling_the_course_uses() {
        let g = parse_general("S –> A1B\nA → 0A | ∈\nB —> 0B | 1B | λ\nC ::= ε\nD -> ").unwrap();
        assert_eq!(
            productions(&g),
            vec!["S → A1B", "A → 0A", "A → ε", "B → 0B", "B → 1B", "B → ε", "C → ε", "D → ε"]
        );
    }

    #[test]
    fn left_sides_may_be_any_string_with_a_nonterminal() {
        let g = parse_general("S -> ASB\naaA -> aaBB\n0S1 -> 01").unwrap();
        assert_eq!(productions(&g)[1], "aaA → aaBB");
        assert_eq!(productions(&g)[2], "0S1 → 01");
    }

    #[test]
    fn rejects_a_left_side_without_nonterminals() {
        let err = parse_general("S -> a\nab -> b").unwrap_err();
        assert_eq!(err.line, 2);
        assert!(err.message.contains("no terminal"), "{}", err.message);
    }

    #[test]
    fn rejects_a_line_without_an_arrow() {
        let err = parse_general("S -> a\nS a").unwrap_err();
        assert_eq!(err.line, 2);
        assert!(err.message.contains("->"), "{}", err.message);
    }

    #[test]
    fn rejects_an_empty_grammar() {
        assert!(parse_general("").is_err());
        assert!(parse_general("  \n// solo un comentario\n").is_err());
    }

    #[test]
    fn reads_the_courses_declarations_and_ignores_headers() {
        let text = "G:\n∑ ={ a, b, c, d}\nN ={ S, A, B}\nS = S\nP =\nS –> ASB\nA -> b\naaA -> aaBB\nS –> d\nA –> aA\nB –> dcd";
        let g = parse_general(text).unwrap();
        assert_eq!(g.terminals, vec!["a", "b", "c", "d"]);
        assert_eq!(g.nonterminals, vec!["S", "A", "B"]);
        assert_eq!(g.start, "S");
        assert_eq!(g.productions.len(), 6);
        assert!(g.warnings.is_empty(), "{:?}", g.warnings);
    }

    #[test]
    fn warns_about_symbols_used_but_not_declared() {
        // The course's type-1 example declares Σ = {a, b} but uses c and D.
        let g = parse_general("Σ = {a, b}\nN = {S, A, B}\nS -> aB\nbA -> bcD\ncD -> cAA").unwrap();
        assert!(g.warnings.iter().any(|w| w.contains("'c'") && w.contains("Σ")), "{:?}", g.warnings);
        assert!(g.warnings.iter().any(|w| w.contains("'D'") && w.contains("N")), "{:?}", g.warnings);
        assert!(g.terminals.contains(&"c".to_string()));
        assert!(g.nonterminals.contains(&"D".to_string()));
    }

    #[test]
    fn named_nonterminals_and_quoted_terminals_are_single_symbols() {
        let g = parse_general("<sentencia> -> 'if' <cond> 'then' <sentencia> | x\n<cond> -> c").unwrap();
        assert_eq!(g.start, "sentencia");
        assert_eq!(g.productions[0].rhs.len(), 4);
        assert_eq!(productions(&g)[0], "<sentencia> → 'if'<cond>'then'<sentencia>");
        assert_eq!(g.terminals, vec!["if", "then", "x", "c"]);
    }

    #[test]
    fn start_symbol_defaults_to_the_first_left_side_without_an_s() {
        let g = parse_general("A -> aB\nB -> b").unwrap();
        assert_eq!(g.start, "A");
    }

    #[test]
    fn an_explicit_start_declaration_wins() {
        let g = parse_general("S = B\nA -> a\nB -> bA").unwrap();
        assert_eq!(g.start, "B");
    }
}
