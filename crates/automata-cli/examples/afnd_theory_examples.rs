//! Reconstructs, byte-for-byte, the two worked AFND-ε diagrams from the
//! course theory material (not invented here — see
//! `ejercicios/teoria-afnd/README.md` for the exact statement each one
//! implements). For each: confirms the system classifies it as NFA,
//! independently re-derives the two conditions the theory says an AFND *is
//! allowed* to have (mirror of the DFA check in `nfa_to_dfa_check.rs`,
//! which re-derived the two conditions a DFA must *never* have), checks the
//! language against hand-derived test cases, then converts to a DFA and
//! checks language equivalence + the formal DFA definition on the result —
//! tying together theory, `engine::fa`, and `convert::nfa_to_dfa` in one
//! pass.
//!
//! Run with: `cargo run -p automata-cli --example afnd_theory_examples`

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use automata_core::convert::nfa_to_dfa;
use automata_core::dto;
use automata_core::engine::fa::FaEngine;
use automata_core::engine::{run_bounded, Budget, Outcome};
use automata_core::ids::{StateId, SymbolId};
use automata_core::model::fa::{Classification, FaDoc};

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

/// Independently re-derives the two conditions the theory says an AFND is
/// *allowed* to exhibit (mirror of `formal_dfa_violations` in
/// `nfa_to_dfa_check.rs`, which checked the conditions a DFA must *forbid*):
/// real branching (two distinct targets for the same (state,symbol)), and
/// epsilon transitions. Does not call `FaDoc::classify`.
fn afnd_evidence(doc: &FaDoc) -> Vec<String> {
    let mut evidence = Vec::new();
    let mut targets_of: HashMap<(StateId, SymbolId), HashSet<StateId>> = HashMap::new();

    for ((from, to), set) in doc.edges() {
        if set.epsilon {
            let flabel = doc.state_label(*from).unwrap_or("?");
            let tlabel = doc.state_label(*to).unwrap_or("?");
            evidence.push(format!("existe δ({flabel}, ε)={tlabel} -> autómata con transiciones vacías (AFND-ε)"));
        }
        for &sym in &set.symbols {
            targets_of.entry((*from, sym)).or_default().insert(*to);
        }
    }
    for ((from, sym), targets) in &targets_of {
        if targets.len() > 1 {
            let flabel = doc.state_label(*from).unwrap_or("?");
            let slabel = doc.symbol_label(*sym).unwrap_or("?");
            evidence.push(format!(
                "δ({flabel}, {slabel}) tiene {} destinos distintos -> no determinismo real",
                targets.len()
            ));
        }
    }
    evidence
}

/// Same DFA-definition check as `nfa_to_dfa_check.rs`'s
/// `formal_dfa_violations`: re-derived from `doc.edges()`, not via
/// `FaDoc::classify`.
fn formal_dfa_violations(doc: &FaDoc) -> Vec<String> {
    let mut violations = Vec::new();
    let mut seen: HashMap<(StateId, SymbolId), StateId> = HashMap::new();
    for ((from, to), set) in doc.edges() {
        if set.epsilon {
            violations.push(format!("δ({:?}, ε) existe", doc.state_label(*from)));
        }
        for &sym in &set.symbols {
            match seen.get(&(*from, sym)) {
                Some(&other) if other != *to => violations.push(format!(
                    "δ({:?}, {:?}) tiene dos destinos distintos",
                    doc.state_label(*from),
                    doc.symbol_label(sym)
                )),
                _ => {
                    seen.insert((*from, sym), *to);
                }
            }
        }
    }
    violations
}

fn ejercicios_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../ejercicios/teoria-afnd")
}

fn save(slug: &str, suffix: &str, doc: &FaDoc) {
    let dir = ejercicios_dir();
    std::fs::create_dir_all(&dir).expect("create ejercicios/teoria-afnd/ dir");
    let path = dir.join(format!("{slug}-{suffix}.json"));
    std::fs::write(&path, dto::save_to_string(doc).unwrap()).expect("write json");
}

struct Example {
    slug: &'static str,
    statement: &'static str,
    nfa: FaDoc,
    cases: Vec<(&'static str, bool)>,
}

fn examples() -> Vec<Example> {
    vec![
        Example {
            slug: "01-multiplo-2-o-3",
            statement: "Diagrama 1 de la teoria: cadenas de 'a' cuya longitud es multiplo de 2 o de 3 \
                         (union via epsilon de un ciclo de periodo 3 (estados 1-2-3) y uno de periodo 2 (4-5))",
            nfa: build_eps(
                &["q0", "q1", "q2", "q3", "q4", "q5"],
                "q0",
                &["q1", "q4"],
                &[
                    ("q0", "q1", "eps"), ("q0", "q4", "eps"),
                    ("q1", "q2", "a"), ("q2", "q3", "a"), ("q3", "q1", "a"),
                    ("q4", "q5", "a"), ("q5", "q4", "a"),
                ],
            ),
            cases: vec![
                ("", true), ("a", false), ("aa", true), ("aaa", true), ("aaaa", true),
                ("aaaaa", false), ("aaaaaa", true), ("aaaaaaa", false),
            ],
        },
        Example {
            slug: "02-uno-no-final",
            statement: "Diagrama 2 de la teoria: cadenas sobre {0,1} que contienen un '1' que no es \
                         el ultimo simbolo (q2 llega a q3 tanto leyendo '0' como por epsilon)",
            nfa: build_eps(
                &["q1", "q2", "q3", "q4"],
                "q1",
                &["q4"],
                &[
                    ("q1", "q1", "01"),
                    ("q1", "q2", "1"),
                    ("q2", "q3", "0"), ("q2", "q3", "eps"),
                    ("q3", "q4", "01"),
                    ("q4", "q4", "01"),
                ],
            ),
            cases: vec![
                ("", false), ("0", false), ("1", false), ("01", false), ("0001", false),
                ("10", true), ("11", true), ("010", true), ("100", true), ("0010", true), ("1111", true),
            ],
        },
    ]
}

fn main() {
    let mut all_ok = true;
    for ex in examples() {
        println!("{}", ex.statement);

        let is_nfa = ex.nfa.classify() == Classification::Nfa;
        let evidence = afnd_evidence(&ex.nfa);
        println!("  clasificacion del sistema: {}", if is_nfa { "AFND (correcto)" } else { "AFD (INCORRECTO)" });
        for e in &evidence {
            println!("    evidencia: {e}");
        }

        let mut lang_ok = true;
        for &(word, expected) in &ex.cases {
            let got = accepts(&ex.nfa, word);
            let ok = got == expected;
            lang_ok &= ok;
            let shown = if word.is_empty() { "ε" } else { word };
            println!(
                "    {}  {:<8} esperado={:<5} obtenido={:<5}{}",
                if ok { "OK  " } else { "FAIL" }, shown, expected, got,
                if ok { "" } else { "  <<<" }
            );
        }

        let dfa = nfa_to_dfa(&ex.nfa);
        let dfa_formal_ok = formal_dfa_violations(&dfa).is_empty();
        let mut dfa_lang_ok = true;
        for &(word, expected) in &ex.cases {
            let got = accepts(&dfa, word);
            dfa_lang_ok &= got == expected;
        }

        let ok = is_nfa && !evidence.is_empty() && lang_ok && dfa_formal_ok && dfa_lang_ok;
        all_ok &= ok;
        println!(
            "  -> {} | AFND confirmado: {} | lenguaje AFND correcto: {} | AFD equivalente ({} estados) cumple definicion formal: {} | lenguaje AFD correcto: {}",
            if ok { "OK" } else { "FALLO" },
            if is_nfa && !evidence.is_empty() { "si" } else { "no" },
            if lang_ok { "si" } else { "no" },
            dfa.states().count(),
            if dfa_formal_ok { "si" } else { "no" },
            if dfa_lang_ok { "si" } else { "no" },
        );

        save(ex.slug, "afnd", &ex.nfa);
        save(ex.slug, "afd", &dfa);
        println!("     guardado en ejercicios/teoria-afnd/{}-{{afnd,afd}}.json\n", ex.slug);
    }

    if !all_ok {
        eprintln!("Al menos un ejemplo fallo.");
        std::process::exit(1);
    }
    println!("Los 2 diagramas de la teoria coinciden con lo que implementa el sistema.");
}
