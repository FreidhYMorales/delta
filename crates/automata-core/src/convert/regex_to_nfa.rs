//! Regex -> NFA by Thompson's construction — the standard textbook
//! algorithm (each sub-expression compiles to a fragment with exactly one
//! entry and one exit state, glued together by ε). Mirrors JFLAP's own
//! regex-to-FA direction (`gui.action.REToFSAAction`), which builds the
//! same shape of automaton.
//!
//! This exists as the round-trip half of `fa_to_regex`'s test suite (build
//! a regex from an automaton, build an automaton back from that regex,
//! check the language matches — see `fa_to_regex.rs`'s tests) as much as it
//! is a feature in its own right; both are true.

use crate::model::fa::FaDoc;
use crate::regex::Regex;

/// A fragment under construction: exactly one entry state and one exit
/// state, wired into `doc`. Composing fragments (concat/union/star) only
/// ever adds new states and ε-edges between existing fragments' entry/exit
/// points — never touches anything else.
struct Fragment {
    entry: crate::ids::StateId,
    exit: crate::ids::StateId,
}

fn fresh_pair(doc: &mut FaDoc) -> (crate::ids::StateId, crate::ids::StateId) {
    let n = doc.state_capacity();
    let a = doc.add_state(&format!("t{n}"), 0.0, 0.0).expect("fresh capacity-derived label is unused");
    let b = doc.add_state(&format!("t{}", n + 1), 0.0, 0.0).expect("fresh capacity-derived label is unused");
    (a, b)
}

fn build(doc: &mut FaDoc, r: &Regex) -> Fragment {
    match r {
        Regex::Empty => {
            // Two disconnected states: no path from entry to exit at all.
            let (entry, exit) = fresh_pair(doc);
            Fragment { entry, exit }
        }
        Regex::Epsilon => {
            let (entry, exit) = fresh_pair(doc);
            doc.add_epsilon_transition(entry, exit);
            Fragment { entry, exit }
        }
        Regex::Symbol(s) => {
            let (entry, exit) = fresh_pair(doc);
            doc.add_transition(entry, exit, s);
            Fragment { entry, exit }
        }
        Regex::Concat(a, b) => {
            let fa = build(doc, a);
            let fb = build(doc, b);
            doc.add_epsilon_transition(fa.exit, fb.entry);
            Fragment { entry: fa.entry, exit: fb.exit }
        }
        Regex::Union(a, b) => {
            let fa = build(doc, a);
            let fb = build(doc, b);
            let (entry, exit) = fresh_pair(doc);
            doc.add_epsilon_transition(entry, fa.entry);
            doc.add_epsilon_transition(entry, fb.entry);
            doc.add_epsilon_transition(fa.exit, exit);
            doc.add_epsilon_transition(fb.exit, exit);
            Fragment { entry, exit }
        }
        Regex::Star(a) => {
            let fa = build(doc, a);
            let (entry, exit) = fresh_pair(doc);
            doc.add_epsilon_transition(entry, fa.entry);
            doc.add_epsilon_transition(fa.exit, exit);
            doc.add_epsilon_transition(entry, exit); // zero repetitions
            doc.add_epsilon_transition(fa.exit, fa.entry); // one more repetition
            Fragment { entry, exit }
        }
    }
}

pub fn regex_to_nfa(r: &Regex) -> FaDoc {
    let mut doc = FaDoc::new();
    let fragment = build(&mut doc, r);
    doc.set_initial(Some(fragment.entry));
    doc.set_accepting(fragment.exit, true);
    doc
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{run_bounded, Budget, Outcome};
    use crate::ids::SymbolId;

    fn accepts(doc: &FaDoc, w: &str) -> bool {
        let engine = crate::engine::fa::FaEngine::compile(doc);
        let input: Vec<SymbolId> = w
            .chars()
            .enumerate()
            .map(|(i, c)| doc.symbol_label_to_id(&c.to_string()).unwrap_or(SymbolId(u32::MAX - i as u32)))
            .collect();
        run_bounded(&engine, &input, Budget::default()).outcome == Outcome::Accepted
    }

    fn sym(s: &str) -> Regex {
        Regex::Symbol(s.to_string())
    }

    #[test]
    fn empty_matches_nothing_not_even_the_empty_string() {
        let doc = regex_to_nfa(&Regex::Empty);
        assert!(!accepts(&doc, ""));
        assert!(!accepts(&doc, "a"));
    }

    #[test]
    fn epsilon_matches_only_the_empty_string() {
        let doc = regex_to_nfa(&Regex::Epsilon);
        assert!(accepts(&doc, ""));
        assert!(!accepts(&doc, "a"));
    }

    #[test]
    fn a_bare_symbol_matches_only_that_one_character() {
        let doc = regex_to_nfa(&sym("a"));
        assert!(accepts(&doc, "a"));
        assert!(!accepts(&doc, ""));
        assert!(!accepts(&doc, "aa"));
        assert!(!accepts(&doc, "b"));
    }

    #[test]
    fn concat_matches_exactly_the_concatenation() {
        let doc = regex_to_nfa(&sym("a").concat(sym("b")));
        assert!(accepts(&doc, "ab"));
        assert!(!accepts(&doc, "a"));
        assert!(!accepts(&doc, "b"));
        assert!(!accepts(&doc, "ba"));
        assert!(!accepts(&doc, ""));
    }

    #[test]
    fn union_matches_either_side() {
        let doc = regex_to_nfa(&sym("a").union(sym("b")));
        assert!(accepts(&doc, "a"));
        assert!(accepts(&doc, "b"));
        assert!(!accepts(&doc, "ab"));
        assert!(!accepts(&doc, ""));
    }

    #[test]
    fn star_matches_zero_or_more_repetitions() {
        let doc = regex_to_nfa(&sym("a").star());
        for w in ["", "a", "aa", "aaaa", "aaaaaaa"] {
            assert!(accepts(&doc, w), "expected {w:?} to be accepted");
        }
        assert!(!accepts(&doc, "b"));
        assert!(!accepts(&doc, "ab"));
    }

    #[test]
    fn a_compound_expression_matches_its_intended_language() {
        // (a+b)*ab : any mix of a/b, then ends in exactly "ab".
        let r = sym("a").union(sym("b")).star().concat(sym("a")).concat(sym("b"));
        let doc = regex_to_nfa(&r);
        for (w, expected) in [("ab", true), ("aab", true), ("bab", true), ("abab", true), ("a", false), ("b", false), ("ba", false), ("", false)] {
            assert_eq!(accepts(&doc, w), expected, "mismatch on {w:?}");
        }
    }
}
