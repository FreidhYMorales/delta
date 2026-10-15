//! BNF / EBNF notation read into a `GeneralGrammar`, with the EBNF
//! constructs expanded into plain BNF rules so the rest of the "Gramática"
//! tab (classification, derivations, trees) works on it unchanged.
//!
//! Two styles, told apart by how rules are named:
//! - With `<name>` rule heads (`idea/nuevos_agregados/Ejemplos
//!   gramáticas.pdf`, the course's main notation): non-terminals are
//!   `<name>` (spaces inside are ignored), every other character is a
//!   terminal on its own (`<signo> ::= +|-| є`), one rule per line, no final
//!   dot needed, ranges written `0|1|…|9`.
//! - With bare rule names (`notacion_bnf_mr_110-112.pdf`): bare names are
//!   non-terminals and terminals are quoted, as described below.
//!
//! Metasymbols:
//! - `::=` "se define como", `|` alternatives, `.` end of rule (optional: a
//!   new `name ::=` also starts the next rule). A rule may span lines.
//! - `( a | b )` grouping, `[ algo ]` zero or one, `{ algo }` zero or more.
//! - `'xyz'` (or `"xyz"`) terminal symbols; bare names (`entero_sin_signo`)
//!   are non-terminals. `ε` (or an empty alternative) is the empty string.
//! - `'0' | '1' | .. | '9'` (or `…`): a range alternative between two
//!   single-character terminals stands for every character between them.
//!
//! EBNF → BNF: `[x]` becomes a new non-terminal `N ::= x | ε`, `{x}` becomes
//! `N ::= x N | ε` and `(a | b)` becomes `N ::= a | b`, each named after the
//! rule it appears in (`entero_opc1`, `entero_rep1`, `entero_grp1`).
//!
//! Messages are user-facing Spanish.

use serde::Serialize;

use super::general::{GeneralGrammar, GeneralProduction, GrammarError, Symbol, EPSILONS};

/// The parsed grammar plus the plain-BNF rules it expands to, as text
/// (`entero ::= entero_opc1 entero_sin_signo .`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BnfGrammar {
    pub grammar: GeneralGrammar,
    pub expansion: Vec<String>,
}

pub fn parse_bnf(text: &str) -> Result<BnfGrammar, GrammarError> {
    let mut warnings = Vec::new();
    let angle = uses_angle_brackets(text);
    let tokens = lex(text, angle, &mut warnings)?;
    let rules = Parser { tokens: &tokens, pos: 0 }.rules()?;
    if rules.is_empty() {
        return Err(error(1, "no hay reglas — escribí una por definición, p. ej. signo ::= '+' | '-' ."));
    }

    // EBNF -> BNF.
    let mut expanded: Vec<(String, usize, Vec<Vec<Sym>>)> = Vec::new();
    let mut expansion = Vec::new();
    for rule in &rules {
        let mut helpers = Vec::new();
        let mut counters = [0usize; 3];
        let alternatives = lower(&rule.name, &rule.expr, &mut counters, &mut helpers);
        expansion.push(rule_text(&rule.name, &alternatives, angle));
        expanded.push((rule.name.clone(), rule.line, alternatives));
        for (name, alternatives) in helpers {
            expansion.push(rule_text(&name, &alternatives, angle));
            expanded.push((name, rule.line, alternatives));
        }
    }

    let mut terminals: Vec<String> = Vec::new();
    let mut nonterminals: Vec<String> = Vec::new();
    for (name, _, _) in &expanded {
        if !nonterminals.contains(name) {
            nonterminals.push(name.clone());
        }
    }
    let defined = nonterminals.clone();
    let mut productions = Vec::new();
    for (name, line, alternatives) in &expanded {
        for alternative in alternatives {
            let rhs: Vec<Symbol> = alternative
                .iter()
                .map(|sym| match sym {
                    Sym::N(n) => {
                        if !nonterminals.contains(n) {
                            nonterminals.push(n.clone());
                        }
                        Symbol::NonTerminal(n.clone())
                    }
                    Sym::T(t) => {
                        if !terminals.contains(t) {
                            terminals.push(t.clone());
                        }
                        Symbol::Terminal(t.clone())
                    }
                })
                .collect();
            productions.push(GeneralProduction { lhs: vec![Symbol::NonTerminal(name.clone())], rhs, line: *line });
        }
    }
    for n in nonterminals.iter().filter(|n| !defined.contains(n)) {
        warnings.push(format!("el no terminal «{n}» no tiene regla: ninguna cadena puede derivarse a través de él"));
    }

    let grammar = GeneralGrammar { terminals, nonterminals, start: rules[0].name.clone(), productions, warnings };
    Ok(BnfGrammar { grammar, expansion })
}

fn error(line: usize, message: impl Into<String>) -> GrammarError {
    GrammarError { line, message: message.into() }
}

// --- Lexer ---------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
enum Tok {
    Name(String),
    Quoted(String),
    Define,
    Bar,
    Open(char),
    Close(char),
    Dot,
    Range,
}

struct Token {
    tok: Tok,
    line: usize,
}

fn is_name_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Rules named `<name> ::= …` (rather than `name ::= …`).
fn uses_angle_brackets(text: &str) -> bool {
    text.match_indices("::=").any(|(at, _)| text[..at].trim_end().ends_with('>'))
}

fn lex(text: &str, angle: bool, warnings: &mut Vec<String>) -> Result<Vec<Token>, GrammarError> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut line = 1;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let rest = &chars[i..];
        let push = |tokens: &mut Vec<Token>, tok| tokens.push(Token { tok, line });
        match c {
            '\n' => line += 1,
            c if c.is_whitespace() => {}
            c if EPSILONS.contains(&c) => {}
            '…' => push(&mut tokens, Tok::Range),
            '.' if rest.starts_with(&['.', '.', '.']) => {
                push(&mut tokens, Tok::Range);
                i += 3;
                continue;
            }
            '/' if rest.get(1) == Some(&'/') => {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
                continue;
            }
            ':' if rest.starts_with(&[':', ':', '=']) => {
                push(&mut tokens, Tok::Define);
                i += 3;
                continue;
            }
            '.' if rest.get(1) == Some(&'.') => {
                push(&mut tokens, Tok::Range);
                i += 2;
                continue;
            }
            // With <name> rules a dot only ends a rule at the end of its
            // line; anywhere else it is a terminal.
            '.' if angle && !rest[1..].iter().take_while(|&&c| c != '\n').all(|c| c.is_whitespace()) => {
                push(&mut tokens, Tok::Quoted(".".into()));
            }
            '.' => push(&mut tokens, Tok::Dot),
            '<' if angle => {
                let start_line = line;
                let mut name = String::new();
                i += 1;
                while i < chars.len() && chars[i] != '>' && chars[i] != '\n' {
                    name.push(chars[i]);
                    i += 1;
                }
                if chars.get(i) != Some(&'>') || name.trim().is_empty() {
                    return Err(error(start_line, "falta '>' para cerrar el nombre del no terminal, p. ej. <digito>"));
                }
                tokens.push(Token { tok: Tok::Name(name.trim().to_string()), line: start_line });
            }
            '|' => push(&mut tokens, Tok::Bar),
            '(' | '[' | '{' => push(&mut tokens, Tok::Open(c)),
            ')' | ']' | '}' => push(&mut tokens, Tok::Close(c)),
            '\'' | '"' => {
                let start_line = line;
                let mut word = String::new();
                i += 1;
                while i < chars.len() && chars[i] != c {
                    if chars[i] == '\n' {
                        line += 1;
                    }
                    word.push(chars[i]);
                    i += 1;
                }
                if i == chars.len() {
                    return Err(error(start_line, format!("falta la comilla {c} de cierre")));
                }
                if word.is_empty() {
                    return Err(error(start_line, "un terminal entre comillas no puede estar vacío"));
                }
                tokens.push(Token { tok: Tok::Quoted(word), line: start_line });
            }
            // With <name> rules, any other character is a terminal on its own.
            c if angle => push(&mut tokens, Tok::Quoted(c.to_string())),
            c if is_name_char(c) => {
                let mut name = String::new();
                while i < chars.len() && is_name_char(chars[i]) {
                    name.push(chars[i]);
                    i += 1;
                }
                push(&mut tokens, Tok::Name(name));
                continue;
            }
            other => {
                let warning = format!("'{other}' sin comillas se tomó como terminal (en BNF los terminales van entre comillas)");
                if !warnings.contains(&warning) {
                    warnings.push(warning);
                }
                push(&mut tokens, Tok::Quoted(other.to_string()));
            }
        }
        i += 1;
    }
    Ok(tokens)
}

// --- Parser --------------------------------------------------------------

#[derive(Debug, Clone)]
enum Item {
    Name(String),
    Term(String),
    Range,
    Group(Vec<Vec<Item>>),
    Optional(Vec<Vec<Item>>),
    Repeat(Vec<Vec<Item>>),
}

struct Rule {
    name: String,
    line: usize,
    expr: Vec<Vec<Item>>,
}

struct Parser<'a> {
    tokens: &'a [Token],
    pos: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<&Tok> {
        self.tokens.get(self.pos).map(|t| &t.tok)
    }

    fn line(&self) -> usize {
        self.tokens.get(self.pos).or_else(|| self.tokens.last()).map_or(1, |t| t.line)
    }

    /// A name followed by `::=` starts the next rule.
    fn at_rule_start(&self) -> bool {
        matches!(self.peek(), Some(Tok::Name(_))) && matches!(self.tokens.get(self.pos + 1).map(|t| &t.tok), Some(Tok::Define))
    }

    fn rules(mut self) -> Result<Vec<Rule>, GrammarError> {
        let mut rules = Vec::new();
        while self.peek().is_some() {
            let line = self.line();
            let Some(Tok::Name(name)) = self.peek().cloned() else {
                return Err(error(line, "se esperaba el nombre de una regla, p. ej. entero ::= …"));
            };
            self.pos += 1;
            if self.peek() != Some(&Tok::Define) {
                return Err(error(self.line(), format!("se esperaba '::=' después de «{name}»")));
            }
            self.pos += 1;
            let expr = self.expr()?;
            match self.peek() {
                Some(Tok::Dot) => self.pos += 1,
                None => {}
                _ if self.at_rule_start() => {}
                Some(Tok::Close(c)) => return Err(error(self.line(), format!("'{c}' inesperado: no hay nada abierto que cierre"))),
                _ => return Err(error(self.line(), format!("falta el '.' al final de la regla «{name}»"))),
            }
            rules.push(Rule { name, line, expr });
        }
        Ok(rules)
    }

    fn expr(&mut self) -> Result<Vec<Vec<Item>>, GrammarError> {
        let line = self.line();
        let mut alternatives = vec![self.sequence()?];
        while self.peek() == Some(&Tok::Bar) {
            self.pos += 1;
            alternatives.push(self.sequence()?);
        }
        expand_ranges(alternatives).map_err(|m| error(line, m))
    }

    fn sequence(&mut self) -> Result<Vec<Item>, GrammarError> {
        let mut items = Vec::new();
        loop {
            if self.at_rule_start() {
                return Ok(items);
            }
            let item = match self.peek().cloned() {
                None | Some(Tok::Bar | Tok::Close(_) | Tok::Dot | Tok::Define) => return Ok(items),
                Some(Tok::Name(n)) => Item::Name(n),
                Some(Tok::Quoted(t)) => Item::Term(t),
                Some(Tok::Range) => Item::Range,
                Some(Tok::Open(open)) => {
                    let open_line = self.line();
                    self.pos += 1;
                    let inner = self.expr()?;
                    let close = match open {
                        '(' => ')',
                        '[' => ']',
                        _ => '}',
                    };
                    if self.peek() != Some(&Tok::Close(close)) {
                        return Err(error(
                            self.line(),
                            format!("falta '{close}' para cerrar el '{open}' de la línea {open_line}"),
                        ));
                    }
                    match open {
                        '(' => Item::Group(inner),
                        '[' => Item::Optional(inner),
                        _ => Item::Repeat(inner),
                    }
                }
            };
            self.pos += 1;
            items.push(item);
        }
    }
}

/// `'0' | .. | '9'`: an alternative that is just `..`, between two
/// single-character terminals, becomes every character in between.
fn expand_ranges(alternatives: Vec<Vec<Item>>) -> Result<Vec<Vec<Item>>, String> {
    if !alternatives.iter().any(|a| matches!(a.as_slice(), [Item::Range])) {
        return Ok(alternatives);
    }
    let single = |a: &Vec<Item>| match a.as_slice() {
        [Item::Term(t)] if t.chars().count() == 1 => t.chars().next(),
        _ => None,
    };
    let message = "'..' solo puede ir entre dos terminales de un carácter, p. ej. '0' | .. | '9'".to_string();
    let mut out: Vec<Vec<Item>> = Vec::new();
    for (i, alternative) in alternatives.iter().enumerate() {
        if !matches!(alternative.as_slice(), [Item::Range]) {
            out.push(alternative.clone());
            continue;
        }
        let from = (i > 0).then(|| single(&alternatives[i - 1])).flatten().ok_or(message.clone())?;
        let to = alternatives.get(i + 1).and_then(single).ok_or(message.clone())?;
        if from >= to {
            return Err(message);
        }
        for c in (from as u32 + 1)..(to as u32) {
            if let Some(c) = char::from_u32(c) {
                out.push(vec![Item::Term(c.to_string())]);
            }
        }
    }
    Ok(out)
}

// --- EBNF -> BNF -----------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
enum Sym {
    N(String),
    T(String),
}

/// Plain BNF alternatives for `expr`; every `( )`, `[ ]` and `{ }` inside
/// becomes a helper rule named after `rule` (pushed to `helpers`).
fn lower(rule: &str, expr: &[Vec<Item>], counters: &mut [usize; 3], helpers: &mut Vec<(String, Vec<Vec<Sym>>)>) -> Vec<Vec<Sym>> {
    expr.iter()
        .map(|sequence| {
            sequence
                .iter()
                .filter_map(|item| match item {
                    Item::Name(n) => Some(Sym::N(n.clone())),
                    Item::Term(t) => Some(Sym::T(t.clone())),
                    Item::Range => None,
                    Item::Group(inner) => Some(helper(rule, 0, "grp", inner, counters, helpers, |alts, _| alts)),
                    Item::Optional(inner) => Some(helper(rule, 1, "opc", inner, counters, helpers, |mut alts, _| {
                        alts.push(vec![]);
                        alts
                    })),
                    Item::Repeat(inner) => Some(helper(rule, 2, "rep", inner, counters, helpers, |alts, name| {
                        let mut alts: Vec<Vec<Sym>> = alts
                            .into_iter()
                            .map(|mut a| {
                                a.push(Sym::N(name.to_string()));
                                a
                            })
                            .collect();
                        alts.push(vec![]);
                        alts
                    })),
                })
                .collect()
        })
        .collect()
}

fn helper(
    rule: &str,
    kind: usize,
    suffix: &str,
    inner: &[Vec<Item>],
    counters: &mut [usize; 3],
    helpers: &mut Vec<(String, Vec<Vec<Sym>>)>,
    shape: impl FnOnce(Vec<Vec<Sym>>, &str) -> Vec<Vec<Sym>>,
) -> Sym {
    counters[kind] += 1;
    let name = format!("{rule}_{suffix}{}", counters[kind]);
    let slot = helpers.len();
    helpers.push((name.clone(), vec![]));
    let alternatives = lower(rule, inner, counters, helpers);
    helpers[slot].1 = shape(alternatives, &name);
    Sym::N(name)
}

/// A rule as text, in the style it was written in: `<n> ::= <d><n_rep1>`
/// with <name> rules, `n ::= d n_rep1 .` with bare names.
fn rule_text(name: &str, alternatives: &[Vec<Sym>], angle: bool) -> String {
    let quoted = |t: &str| if t.contains('\'') { format!("\"{t}\"") } else { format!("'{t}'") };
    let alternative_text = |a: &Vec<Sym>| {
        if a.is_empty() {
            return "ε".to_string();
        }
        let parts = a.iter().map(|s| match s {
            Sym::N(n) if angle => format!("<{n}>"),
            Sym::N(n) => n.clone(),
            Sym::T(t) if angle && t.chars().count() == 1 && !"|()[]{}<>'\" ".contains(t.as_str()) => t.clone(),
            Sym::T(t) => quoted(t),
        });
        parts.collect::<Vec<_>>().join(if angle { "" } else { " " })
    };
    let body = alternatives.iter().map(alternative_text).collect::<Vec<_>>().join(" | ");
    if angle {
        format!("<{name}> ::= {body}")
    } else {
        format!("{name} ::= {body} .")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grammar::chomsky::classify;
    use crate::grammar::derive::{derive, DerivationOrder, DeriveOutcome};

    fn productions(g: &GeneralGrammar) -> Vec<String> {
        g.productions.iter().map(|p| p.to_string()).collect()
    }

    fn accepts(g: &GeneralGrammar, start: &str, input: &str) -> bool {
        let mut g = g.clone();
        g.start = start.to_string();
        derive(&g, input, DerivationOrder::Leftmost).outcome == DeriveOutcome::Accepted
    }

    const INTEGER: &str = "digito ::= '0' | '1' | '2' | .. | '9'.\n\
                           signo ::= '+' | '-' .\n\
                           entero_sin_signo ::= digito { digito }.\n\
                           entero ::= [ signo ] entero_sin_signo.";

    // `Ejemplos gramáticas.pdf`: <name> non-terminals, bare characters as
    // terminals, one rule per line, `…` ranges and `є`.
    const PERSON_NAME: &str = "<nombre> ::= <pnombre><pnombre>\n\
                               <pnombre> ::= <lmayus><lminus>\n\
                               <lmayus> ::= A|B|C|…|Z\n\
                               <lminus> ::= <letra><lminus> | є\n\
                               <letra> ::= a|b|c|…|z";

    #[test]
    fn angle_bracket_bnf_from_the_course_example_person_name() {
        let b = parse_bnf(PERSON_NAME).unwrap();
        assert_eq!(b.grammar.start, "nombre");
        assert!(accepts(&b.grammar, "nombre", "Juan Perez"));
        assert!(accepts(&b.grammar, "nombre", "JuanPerez"));
        assert!(!accepts(&b.grammar, "nombre", "juan Perez"));
        assert!(!accepts(&b.grammar, "nombre", "Juan"));
        assert!(b.grammar.warnings.is_empty(), "{:?}", b.grammar.warnings);
    }

    #[test]
    fn angle_bracket_bnf_integers_with_and_without_sign() {
        let unsigned = parse_bnf("<entero> ::= <digito><entero> |є\n<digito> ::= 0|1|…|9").unwrap();
        for w in ["5", "15", "250"] {
            assert!(accepts(&unsigned.grammar, "entero", w), "{w}");
        }
        let signed =
            parse_bnf("<entero> ::= <signo><digito><entero> |<digito><entero>|є\n<digito> ::= 0|1|…|9\n<signo> ::= +|-| є")
                .unwrap();
        assert!(accepts(&signed.grammar, "entero", "-25"));
        assert!(accepts(&signed.grammar, "entero", "25"));
        assert!(!accepts(&signed.grammar, "entero", "2-"));
    }

    #[test]
    fn spaces_inside_angle_brackets_do_not_matter() {
        let b = parse_bnf("<nombre> ::= < pnombre >\n<pnombre> ::= x").unwrap();
        assert!(accepts(&b.grammar, "nombre", "x"));
    }

    #[test]
    fn angle_bracket_ebnf_expands_in_the_same_notation() {
        let b = parse_bnf("<n> ::= <d> { <d> }\n<d> ::= 0|1").unwrap();
        assert!(b.expansion.contains(&"<n> ::= <d><n_rep1>".to_string()), "{:?}", b.expansion);
        assert!(b.expansion.contains(&"<n_rep1> ::= <d><n_rep1> | ε".to_string()), "{:?}", b.expansion);
        assert!(b.expansion.contains(&"<d> ::= 0 | 1".to_string()), "{:?}", b.expansion);
    }

    #[test]
    fn plain_bnf_rules_with_alternatives() {
        let b = parse_bnf("signo ::= '+' | '-' .").unwrap();
        assert_eq!(productions(&b.grammar), vec!["<signo> → +", "<signo> → -"]);
        assert_eq!(b.grammar.start, "signo");
        assert_eq!(b.grammar.terminals, vec!["+", "-"]);
    }

    #[test]
    fn a_character_range_expands_to_every_character() {
        let b = parse_bnf("digito ::= '0' | '1' | .. | '9'.").unwrap();
        assert_eq!(b.grammar.productions.len(), 10);
        assert_eq!(b.grammar.terminals, vec!["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    }

    #[test]
    fn braces_become_a_right_recursive_rule() {
        let b = parse_bnf("n ::= d { d }.\nd ::= '0' | '1'.").unwrap();
        assert!(b.expansion.contains(&"n ::= d n_rep1 .".to_string()), "{:?}", b.expansion);
        assert!(b.expansion.contains(&"n_rep1 ::= d n_rep1 | ε .".to_string()), "{:?}", b.expansion);
    }

    #[test]
    fn brackets_become_an_optional_rule_and_parens_a_group_rule() {
        let b = parse_bnf("e ::= [ s ] (x | y).\ns ::= '-'.\nx ::= 'x'.\ny ::= 'y'.").unwrap();
        assert!(b.expansion.contains(&"e ::= e_opc1 e_grp1 .".to_string()), "{:?}", b.expansion);
        assert!(b.expansion.contains(&"e_opc1 ::= s | ε .".to_string()), "{:?}", b.expansion);
        assert!(b.expansion.contains(&"e_grp1 ::= x | y .".to_string()), "{:?}", b.expansion);
    }

    #[test]
    fn the_integer_rules_from_the_course_derive_signed_numbers() {
        let b = parse_bnf(INTEGER).unwrap();
        assert_eq!(classify(&b.grammar).chomsky_type, 2);
        assert!(accepts(&b.grammar, "entero", "-42"));
        assert!(accepts(&b.grammar, "entero", "7"));
        assert!(!accepts(&b.grammar, "entero", "4-2"));
        assert!(!accepts(&b.grammar, "entero", "+"));
    }

    #[test]
    fn identifier_exercises_from_the_course() {
        // Exercises 3 and 4: an identifier starts with a letter and cannot
        // end with an underscore.
        let text = "identificador ::= letra { [ guión_bajo ] (letra | digito) }.\n\
                    letra ::= 'a' | .. | 'z'.\n\
                    digito ::= '0' | .. | '9'.\n\
                    guión_bajo ::= '_'.";
        let b = parse_bnf(text).unwrap();
        assert!(accepts(&b.grammar, "identificador", "a_1"));
        assert!(accepts(&b.grammar, "identificador", "x"));
        assert!(!accepts(&b.grammar, "identificador", "_a"));
        assert!(!accepts(&b.grammar, "identificador", "1a"));
        assert!(!accepts(&b.grammar, "identificador", "a_"));
    }

    #[test]
    fn multi_line_rules_and_keyword_terminals() {
        let text = "sentencia_if ::=\n  'if' cond\n  'then' s\n  ['else' s].\ncond ::= 'c'.\ns ::= 'x'.";
        let b = parse_bnf(text).unwrap();
        assert!(accepts(&b.grammar, "sentencia_if", "if c then x"));
        assert!(accepts(&b.grammar, "sentencia_if", "if c then x else x"));
        assert!(!accepts(&b.grammar, "sentencia_if", "if c else x"));
    }

    #[test]
    fn an_empty_rule_is_the_empty_string() {
        let b = parse_bnf("sentencia_vacia ::= .").unwrap();
        assert_eq!(productions(&b.grammar), vec!["<sentencia_vacia> → ε"]);
    }

    #[test]
    fn rules_without_the_final_dot_still_split_at_the_next_definition() {
        let b = parse_bnf("a ::= 'x' b\nb ::= 'y'").unwrap();
        assert_eq!(productions(&b.grammar), vec!["a → xb", "b → y"]);
    }

    #[test]
    fn warns_about_non_terminals_without_a_rule_and_unquoted_symbols() {
        let b = parse_bnf("secuencia ::= sentencia {; sentencia}.").unwrap();
        assert!(b.grammar.warnings.iter().any(|w| w.contains("sentencia") && w.contains("regla")), "{:?}", b.grammar.warnings);
        assert!(b.grammar.warnings.iter().any(|w| w.contains("';'")), "{:?}", b.grammar.warnings);
    }

    #[test]
    fn reports_syntax_errors_with_their_line() {
        let err = parse_bnf("a ::= 'x'.\nb ::= [ 'y' .").unwrap_err();
        assert_eq!(err.line, 2);
        assert!(err.message.contains("]"), "{}", err.message);
        assert!(parse_bnf("a 'x'.").is_err());
        assert!(parse_bnf("").is_err());
    }
}
