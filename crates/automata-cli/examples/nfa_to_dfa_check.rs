//! Builds 4 genuinely-NFA language statements (union via epsilon, Kleene
//! star via epsilon, and a pure-branching "guess" NFA with no epsilon at
//! all), converts each with `convert::nfa_to_dfa`, and checks the result
//! two independent ways:
//!
//! 1. **Language equivalence**: the DFA accepts exactly the same test words
//!    as the original NFA.
//! 2. **Formal DFA definition**: re-derived directly from `doc.edges()`
//!    (not by calling `FaDoc::classify`, which is the thing under test) —
//!    the two conditions a real AFD must never violate: no δ(q,ε)
//!    transitions, and no two distinct transitions δ(q,a)=q1, δ(q,a)=q2.
//!
//! Run with: `cargo run -p automata-cli --example nfa_to_dfa_check`

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use automata_core::convert::nfa_to_dfa;
use automata_core::dto;
use automata_core::engine::fa::FaEngine;
use automata_core::engine::{run_bounded, Budget, Outcome};
use automata_core::ids::{StateId, SymbolId};
use automata_core::model::fa::FaDoc;

fn build(states: &[&str], initial: &str, accepting: &[&str], edges: &[(&str, &str, &str)]) -> FaDoc {
    let mut doc = FaDoc::new();
    let mut id_of = HashMap::new();
    for &s in states {
        id_of.insert(s, doc.add_state(s, 0.0, 0.0).unwrap());
    }
    doc.set_initial(Some(id_of[initial]));
    for &s in accepting {
        doc.set_accepting(id_of[s], true);
    }
    for &(from, to, symbols) in edges {
        for c in symbols.chars() {
            doc.add_transition(id_of[from], id_of[to], &c.to_string());
        }
    }
    doc
}

fn build_eps(states: &[&str], initial: &str, accepting: &[&str], edges: &[(&str, &str, &str)]) -> FaDoc {
    let mut doc = FaDoc::new();
    let mut id_of = HashMap::new();
    for &s in states {
        id_of.insert(s, doc.add_state(s, 0.0, 0.0).unwrap());
    }
    doc.set_initial(Some(id_of[initial]));
    for &s in accepting {
        doc.set_accepting(id_of[s], true);
    }
    for &(from, to, symbols) in edges {
        if symbols == "eps" {
            doc.add_epsilon_transition(id_of[from], id_of[to]);
        } else {
            for c in symbols.chars() {
                doc.add_transition(id_of[from], id_of[to], &c.to_string());
            }
        }
    }
    doc
}

fn word_to_symbols(doc: &FaDoc, w: &str) -> Vec<SymbolId> {
    w.chars()
        .enumerate()
        .map(|(i, c)| doc.symbol_label_to_id(&c.to_string()).unwrap_or(SymbolId(u32::MAX - i as u32)))
        .collect()
}

fn accepts(doc: &FaDoc, w: &str) -> bool {
    let engine = FaEngine::compile(doc);
    let input = word_to_symbols(doc, w);
    run_bounded(&engine, &input, Budget::default()).outcome == Outcome::Accepted
}

/// Independent re-check of the two conditions the theory forbids in a DFA,
/// derived straight from `doc.edges()` — deliberately does *not* call
/// `FaDoc::classify`, which is the production logic this is meant to
/// corroborate, not assume correct.
fn formal_dfa_violations(doc: &FaDoc) -> Vec<String> {
    let mut violations = Vec::new();
    let mut seen: HashMap<(StateId, SymbolId), StateId> = HashMap::new();

    for ((from, to), set) in doc.edges() {
        if set.epsilon {
            let label = doc.state_label(*from).unwrap_or("?");
            violations.push(format!("existe δ({label}, ε): transición epsilon prohibida en un AFD"));
        }
        for &sym in &set.symbols {
            match seen.get(&(*from, sym)) {
                Some(&other) if other != *to => {
                    let flabel = doc.state_label(*from).unwrap_or("?");
                    let slabel = doc.symbol_label(sym).unwrap_or("?");
                    let l1 = doc.state_label(other).unwrap_or("?");
                    let l2 = doc.state_label(*to).unwrap_or("?");
                    violations.push(format!(
                        "δ({flabel}, {slabel}) tiene dos destinos distintos: {l1} y {l2}"
                    ));
                }
                _ => {
                    seen.insert((*from, sym), *to);
                }
            }
        }
    }
    violations
}

fn ejercicios_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../ejercicios/nfa")
}

fn save(slug: &str, suffix: &str, doc: &FaDoc) {
    let dir = ejercicios_dir();
    std::fs::create_dir_all(&dir).expect("create ejercicios/nfa/ dir");
    let path = dir.join(format!("{slug}-{suffix}.json"));
    std::fs::write(&path, dto::save_to_string(doc).unwrap()).expect("write json");
}

struct Exercise {
    slug: &'static str,
    statement: &'static str,
    nfa: FaDoc,
    cases: Vec<(&'static str, bool)>,
}

fn exercises() -> Vec<Exercise> {
    vec![
        Exercise {
            slug: "01-contiene-aa-o-bb",
            statement: "1. Cadenas que contengan la subcadena aa o bb (union via epsilon de dos detectores)",
            nfa: build_eps(
                &["q0", "aa0", "aa1", "aaF", "bb0", "bb1", "bbF"],
                "q0",
                &["aaF", "bbF"],
                &[
                    ("q0", "aa0", "eps"), ("q0", "bb0", "eps"),
                    ("aa0", "aa1", "a"), ("aa0", "aa0", "b"),
                    ("aa1", "aaF", "a"), ("aa1", "aa0", "b"),
                    ("aaF", "aaF", "ab"),
                    ("bb0", "bb1", "b"), ("bb0", "bb0", "a"),
                    ("bb1", "bbF", "b"), ("bb1", "bb0", "a"),
                    ("bbF", "bbF", "ab"),
                ],
            ),
            cases: vec![
                ("aa", true), ("bb", true), ("aabb", true), ("baa", true), ("aabbaa", true),
                ("ab", false), ("aba", false), ("ababab", false), ("a", false), ("", false),
            ],
        },
        Exercise {
            slug: "02-cero-o-mas-ab",
            statement: "2. Cero o mas repeticiones de \"ab\", es decir (ab)* (cierre de Kleene, construccion de Thompson con epsilon)",
            nfa: build_eps(
                &["sStart", "sA_in", "sA_out", "sB_in", "sB_out", "sAccept"],
                "sStart",
                &["sAccept"],
                &[
                    ("sStart", "sA_in", "eps"), ("sStart", "sAccept", "eps"),
                    ("sA_in", "sA_out", "a"),
                    ("sA_out", "sB_in", "eps"),
                    ("sB_in", "sB_out", "b"),
                    ("sB_out", "sA_in", "eps"), ("sB_out", "sAccept", "eps"),
                ],
            ),
            cases: vec![
                ("", true), ("ab", true), ("abab", true), ("ababab", true),
                ("a", false), ("b", false), ("aba", false), ("abb", false), ("aab", false), ("ba", false),
            ],
        },
        Exercise {
            slug: "03-antepenultimo-a",
            statement: "3. El simbolo antepenultimo (tercero contando desde el final) es 'a' \
                         (adivinanza no determinista real, sin epsilon; ejemplo clasico de \
                         explosion exponencial de la construccion de subconjuntos)",
            nfa: build(
                &["q0", "q1", "q2", "q3"],
                "q0",
                &["q3"],
                &[
                    ("q0", "q0", "ab"),
                    ("q0", "q1", "a"), // second target for (q0, 'a'): real NFA branching, the "guess"
                    ("q1", "q2", "ab"),
                    ("q2", "q3", "ab"),
                ],
            ),
            cases: vec![
                ("aaa", true), ("aba", true), ("abb", true), ("bba", false),
                ("baba", true), ("aaba", true), ("abab", false), ("bbba", false),
                ("", false), ("a", false), ("aa", false),
            ],
        },
        Exercise {
            slug: "04-inicia-a-o-termina-b",
            statement: "4. Cadenas que inicien con 'a' o que finalicen con 'b' (union via epsilon de dos condiciones simples)",
            nfa: build_eps(
                &["q0", "aStart", "aAcc", "aDead", "bA", "bB"],
                "q0",
                &["aAcc", "bB"],
                &[
                    ("q0", "aStart", "eps"), ("q0", "bA", "eps"),
                    ("aStart", "aAcc", "a"), ("aStart", "aDead", "b"),
                    ("aAcc", "aAcc", "ab"),
                    ("aDead", "aDead", "ab"),
                    ("bA", "bA", "a"), ("bA", "bB", "b"),
                    ("bB", "bA", "a"), ("bB", "bB", "b"),
                ],
            ),
            cases: vec![
                ("a", true), ("b", true), ("ab", true), ("bb", true), ("aa", true), ("bab", true),
                ("ba", false), ("bba", false), ("", false),
            ],
        },
    ]
}

fn main() {
    let mut all_ok = true;
    for ex in exercises() {
        println!("{}", ex.statement);

        let dfa = nfa_to_dfa(&ex.nfa);

        let mut lang_ok = true;
        for &(word, expected) in &ex.cases {
            let nfa_got = accepts(&ex.nfa, word);
            let dfa_got = accepts(&dfa, word);
            let ok = nfa_got == expected && dfa_got == expected;
            lang_ok &= ok;
            let shown = if word.is_empty() { "ε" } else { word };
            println!(
                "    {}  {:<8} esperado={:<5} AFN={:<5} AFD={:<5}{}",
                if ok { "OK  " } else { "FAIL" },
                shown, expected, nfa_got, dfa_got,
                if ok { "" } else { "  <<<" }
            );
        }

        let violations = formal_dfa_violations(&dfa);
        let formal_ok = violations.is_empty();
        if !formal_ok {
            for v in &violations {
                println!("    VIOLACION FORMAL: {v}");
            }
        }

        let ok = lang_ok && formal_ok;
        all_ok &= ok;
        println!(
            "  -> {} | equivalencia de lenguaje: {} | cumple definicion formal de AFD: {} | AFN {} estados -> AFD {} estados",
            if ok { "OK" } else { "FALLO" },
            if lang_ok { "si" } else { "no" },
            if formal_ok { "si" } else { "no" },
            ex.nfa.states().count(),
            dfa.states().count(),
        );

        save(ex.slug, "nfa", &ex.nfa);
        save(ex.slug, "dfa", &dfa);
        println!("     guardado en ejercicios/nfa/{}-{{nfa,dfa}}.json\n", ex.slug);
    }

    if !all_ok {
        eprintln!("Al menos un ejercicio fallo.");
        std::process::exit(1);
    }
    println!("Los 4 ejercicios NFA->DFA pasaron: equivalencia de lenguaje y definicion formal de AFD.");
}
