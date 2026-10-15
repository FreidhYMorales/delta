//! Chomsky hierarchy classification of a `GeneralGrammar`, with the
//! definitions the course uses (`idea/nuevos_agregados/Jerarquía de
//! Chomsky.pdf`):
//!
//! - Type 3 (regular): every production is right-linear (`A → xB` or
//!   `A → x`, x a possibly empty string of terminals) — or every one is
//!   left-linear (`A → Bx` or `A → x`). Mixing both sides is not regular.
//! - Type 2 (context-free): every left side is a single non-terminal.
//! - Type 1 (context-sensitive): every production has the form
//!   `xAy → xzy` — the context x, y is kept and z is not empty — except
//!   `S → ε` when the start symbol S appears on no right side.
//! - Type 0 (unrestricted): anything else.
//!
//! The result keeps one check per level, each naming the first production
//! that breaks it, so the tab can explain *why* a grammar is the type it is.
//! Explanations are user-facing Spanish.

use serde::Serialize;

use super::general::{GeneralGrammar, GeneralProduction};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LevelCheck {
    /// 3, 2 or 1.
    pub level: u8,
    pub holds: bool,
    pub explanation: String,
    /// The first production that breaks this level, as text.
    pub offending: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Classification {
    /// The most restrictive level every production satisfies (0..=3).
    pub chomsky_type: u8,
    /// Levels 3, 2 and 1, in that order.
    pub checks: Vec<LevelCheck>,
}

pub fn classify(grammar: &GeneralGrammar) -> Classification {
    let checks = vec![check_regular(grammar), check_context_free(grammar), check_context_sensitive(grammar)];
    let chomsky_type = checks.iter().find(|c| c.holds).map_or(0, |c| c.level);
    Classification { chomsky_type, checks }
}

fn passes(level: u8, explanation: &str) -> LevelCheck {
    LevelCheck { level, holds: true, explanation: explanation.to_string(), offending: None }
}

fn fails(level: u8, production: &GeneralProduction, explanation: String) -> LevelCheck {
    LevelCheck { level, holds: false, explanation, offending: Some(production.to_string()) }
}

fn single_nonterminal_lhs(p: &GeneralProduction) -> bool {
    p.lhs.len() == 1 && p.lhs[0].is_nonterminal()
}

fn nonterminal_count(p: &GeneralProduction) -> usize {
    p.rhs.iter().filter(|s| s.is_nonterminal()).count()
}

/// `A → xB` or `A → x` (x terminals, possibly empty).
fn right_linear(p: &GeneralProduction) -> bool {
    single_nonterminal_lhs(p) && p.rhs.iter().rev().skip(1).all(|s| !s.is_nonterminal())
}

/// `A → Bx` or `A → x`.
fn left_linear(p: &GeneralProduction) -> bool {
    single_nonterminal_lhs(p) && p.rhs.iter().skip(1).all(|s| !s.is_nonterminal())
}

fn check_regular(grammar: &GeneralGrammar) -> LevelCheck {
    for p in &grammar.productions {
        if right_linear(p) || left_linear(p) {
            continue;
        }
        let why = if !single_nonterminal_lhs(p) {
            "el lado izquierdo no es un único no terminal"
        } else if nonterminal_count(p) > 1 {
            "el lado derecho tiene más de un no terminal"
        } else {
            "el no terminal del lado derecho no está ni al final ni al principio"
        };
        return fails(3, p, format!("{p}: {why}."));
    }
    // Every production is linear on its own; all must lean the same way.
    let right_only = grammar.productions.iter().find(|p| right_linear(p) && !left_linear(p));
    let left_only = grammar.productions.iter().find(|p| left_linear(p) && !right_linear(p));
    match (right_only, left_only) {
        (Some(r), Some(l)) => {
            let later = if r.line > l.line { r } else { l };
            fails(
                3,
                later,
                format!(
                    "mezcla producciones lineales por la derecha ({r}) y por la izquierda ({l}); una gramática regular usa un solo lado."
                ),
            )
        }
        (None, Some(_)) => passes(3, "Todas las producciones son lineales por la izquierda (A → Bx o A → x)."),
        _ => passes(3, "Todas las producciones son lineales por la derecha (A → xB o A → x)."),
    }
}

fn check_context_free(grammar: &GeneralGrammar) -> LevelCheck {
    match grammar.productions.iter().find(|p| !single_nonterminal_lhs(p)) {
        Some(p) => fails(2, p, format!("{p}: el lado izquierdo no es un único no terminal.")),
        None => passes(2, "Todo lado izquierdo es un único no terminal (A → γ)."),
    }
}

fn check_context_sensitive(grammar: &GeneralGrammar) -> LevelCheck {
    let start_on_a_right_side = grammar
        .productions
        .iter()
        .any(|p| p.rhs.iter().any(|s| s.is_nonterminal() && s.name() == grammar.start));
    for p in &grammar.productions {
        let start_to_epsilon =
            p.rhs.is_empty() && single_nonterminal_lhs(p) && p.lhs[0].name() == grammar.start;
        if start_to_epsilon && !start_on_a_right_side {
            continue;
        }
        if keeps_context(p) {
            continue;
        }
        let why = if p.rhs.is_empty() {
            "borra símbolos (z no puede ser vacía; solo se permite S → ε si S no aparece en ningún lado derecho)"
        } else if p.rhs.len() < p.lhs.len() {
            "el lado derecho es más corto que el izquierdo"
        } else {
            "no conserva el contexto: no tiene la forma xAy → xzy"
        };
        return fails(1, p, format!("{p}: {why}."));
    }
    passes(1, "Toda producción tiene la forma xAy → xzy (conserva el contexto x, y y z no es vacía).")
}

/// `xAy → xzy`: some non-terminal A of the left side is rewritten into a
/// non-empty z while everything around it (x, y) stays the same.
fn keeps_context(p: &GeneralProduction) -> bool {
    context_split(p).is_some()
}

/// For a production of the form `xAy → xzy` (z not empty), the index of A
/// in the left side — the one symbol it actually rewrites. Every
/// context-free production `A → γ` (γ not empty) qualifies with index 0.
pub(crate) fn context_split(p: &GeneralProduction) -> Option<usize> {
    (0..p.lhs.len()).find(|&i| {
        let (x, y) = (&p.lhs[..i], &p.lhs[i + 1..]);
        p.lhs[i].is_nonterminal()
            && p.rhs.len() > x.len() + y.len()
            && p.rhs.starts_with(x)
            && p.rhs.ends_with(y)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grammar::general::parse_general;

    fn type_of(text: &str) -> u8 {
        classify(&parse_general(text).unwrap()).chomsky_type
    }

    fn check(text: &str, level: u8) -> LevelCheck {
        classify(&parse_general(text).unwrap()).checks.into_iter().find(|c| c.level == level).unwrap()
    }

    #[test]
    fn right_linear_grammar_is_type_3() {
        // Jerarquía de Chomsky.pdf, type-3 example (and GRAMÁTICAS.pdf ejercicio 3).
        assert_eq!(type_of("S -> aS\nS -> aA\nA -> bA\nA -> b"), 3);
    }

    #[test]
    fn left_linear_grammar_is_type_3_too() {
        assert_eq!(type_of("S -> Sa | Ab\nA -> b"), 3);
        assert!(check("S -> Sa | Ab\nA -> b", 3).explanation.contains("izquierda"));
    }

    #[test]
    fn epsilon_productions_and_terminal_strings_are_still_linear() {
        assert_eq!(type_of("S -> abS | ε"), 3);
    }

    #[test]
    fn mixing_right_and_left_linear_is_not_regular() {
        let c = check("S -> aA\nA -> Sb", 3);
        assert!(!c.holds);
        assert_eq!(type_of("S -> aA\nA -> Sb"), 2);
    }

    #[test]
    fn context_free_example_is_type_2_and_names_the_non_linear_production() {
        // Jerarquía de Chomsky.pdf, type-2 example (and GRAMÁTICAS.pdf ejercicio 2).
        let text = "S -> aB\nS -> bA\nA -> a\nA -> aS\nA -> bAA\nB -> b\nB -> bS\nB -> aBB";
        assert_eq!(type_of(text), 2);
        let c = check(text, 3);
        assert!(!c.holds);
        assert_eq!(c.offending.as_deref(), Some("A → bAA"));
    }

    #[test]
    fn grammar_for_0_star_1_0_or_1_star_is_type_2() {
        // GRAMÁTICAS.pdf: S -> A1B is not linear (two non-terminals).
        assert_eq!(type_of("S -> A1B\nA -> 0A | ε\nB -> 0B | 1B | ε"), 2);
    }

    #[test]
    fn context_sensitive_example_is_type_1() {
        // Jerarquía de Chomsky.pdf, type-1 example.
        let text = "S -> aB\nB -> bAb\nbA -> bcD\ncD -> cAA\nA -> aaA\nA -> b";
        assert_eq!(type_of(text), 1);
        let c = check(text, 2);
        assert!(!c.holds);
        assert_eq!(c.offending.as_deref(), Some("bA → bcD"));
    }

    #[test]
    fn derivations_exercise_grammar_is_type_1() {
        // GRAMÁTICAS.pdf: aaA -> aaBB keeps the context "aa".
        assert_eq!(type_of("S -> ASB\nA -> b\naaA -> aaBB\nS -> d\nA -> aA\nB -> dcd"), 1);
    }

    #[test]
    fn unrestricted_example_is_type_0() {
        // Jerarquía de Chomsky.pdf, type-0 example: 0S1 -> 01 shrinks.
        let text = "S -> 000S111\n0S1 -> 01";
        assert_eq!(type_of(text), 0);
        let c = check(text, 1);
        assert!(!c.holds);
        assert_eq!(c.offending.as_deref(), Some("0S1 → 01"));
    }

    #[test]
    fn a_rule_that_does_not_keep_its_context_is_type_0() {
        // GRAMÁTICAS.pdf ejercicio 1: abA -> baab is not of the form xAy -> xzy.
        assert_eq!(type_of("S -> abAS\nabA -> baab\nS -> a\nA -> b"), 0);
    }

    #[test]
    fn s_to_epsilon_is_allowed_in_type_1_only_when_s_is_not_on_a_right_side() {
        assert_eq!(type_of("S -> ε\nS -> aAb\naA -> aab\nA -> b"), 1);
        // A -> ε (not the start symbol) breaks type 1.
        assert_eq!(type_of("S -> aAb\naA -> aab\nA -> ε"), 0);
        // S -> ε while S appears on a right side breaks type 1 too.
        assert_eq!(type_of("S -> ε\nS -> aSb\naS -> aab"), 0);
    }

    #[test]
    fn every_level_check_is_reported_in_order() {
        let c = classify(&parse_general("S -> aS | b").unwrap());
        assert_eq!(c.checks.iter().map(|c| c.level).collect::<Vec<_>>(), vec![3, 2, 1]);
        assert!(c.checks.iter().all(|c| c.holds && c.offending.is_none()));
    }
}
