//! Builds DFAs with deliberate, hand-verified redundancy, minimizes each,
//! and checks the result three independent ways: language equivalence,
//! *true* minimality (a from-scratch "table-filling" checker — see
//! `is_truly_minimal` — not a call into `minimize_dfa`'s own code), and the
//! formal DFA definition (same style as `nfa_to_dfa_check.rs`). Also
//! re-minimizes every DFA already produced by `nfa_to_dfa_check.rs` and
//! `afnd_theory_examples.rs`, closing the loop across all three sessions.
//!
//! Every "before" automaton is saved as both native `.json` and JFLAP
//! `.jff` — the `.jff` can be opened directly in `idea/JFLAP7.1.jar` and
//! minimized there, to compare against what this produces.
//!
//! Run with: `cargo run -p automata-cli --example minimize_check`

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use automata_core::convert::minimize_dfa;
use automata_core::dto;
use automata_core::engine::fa::FaEngine;
use automata_core::engine::{run_bounded, Budget, Outcome};
use automata_core::ids::{StateId, SymbolId};
use automata_core::interop::jff::writer;
use automata_core::model::fa::FaDoc;

/// Places states on a circle instead of all at `(0,0)` — cosmetic, but the
/// `.jff` files here are meant to be opened in real JFLAP for comparison,
/// and stacked-at-the-origin states are unreadable without manually
/// re-arranging them first.
fn build(states: &[&str], initial: &str, accepting: &[&str], edges: &[(&str, &str, &str)]) -> FaDoc {
    let mut doc = FaDoc::new();
    let mut id_of = HashMap::new();
    let n = states.len().max(1) as f64;
    let (cx, cy, radius) = (200.0, 200.0, 150.0);
    for (i, &s) in states.iter().enumerate() {
        let angle = 2.0 * std::f64::consts::PI * (i as f64) / n;
        let (x, y) = (cx + radius * angle.cos(), cy + radius * angle.sin());
        id_of.insert(s, doc.add_state(s, x, y).unwrap());
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

/// Independent (does not call `minimize_dfa`) "table-filling" check that no
/// two states of `doc` are Myhill-Nerode equivalent. Same technique as the
/// one added to `minimize_dfa.rs`'s own test module, reimplemented here
/// rather than imported, so this example doesn't depend on test-only code.
fn is_truly_minimal(doc: &FaDoc) -> bool {
    let states: Vec<StateId> = doc.states().collect();
    let n = states.len();
    if n <= 1 {
        return true;
    }
    let alphabet: Vec<SymbolId> = doc.alphabet().into_iter().collect();
    let mut delta: HashMap<(StateId, SymbolId), StateId> = HashMap::new();
    for ((from, to), set) in doc.edges() {
        for &sym in &set.symbols {
            delta.insert((*from, sym), *to);
        }
    }
    let idx: HashMap<StateId, usize> = states.iter().enumerate().map(|(i, &s)| (s, i)).collect();
    let dead = n;
    let total = n + 1;
    let target = |u: usize, a: SymbolId| -> usize {
        if u == dead {
            return dead;
        }
        delta.get(&(states[u], a)).map_or(dead, |t| idx[t])
    };
    let is_acc = |u: usize| u != dead && doc.is_accepting(states[u]);

    let mut distinguished = vec![vec![false; total]; total];
    #[allow(clippy::needless_range_loop)]
    for i in 0..total {
        for j in (i + 1)..total {
            if is_acc(i) != is_acc(j) {
                distinguished[i][j] = true;
                distinguished[j][i] = true;
            }
        }
    }
    loop {
        let mut changed = false;
        #[allow(clippy::needless_range_loop)]
        for i in 0..total {
            for j in (i + 1)..total {
                if distinguished[i][j] {
                    continue;
                }
                for &a in &alphabet {
                    let (ti, tj) = (target(i, a), target(j, a));
                    if ti != tj && distinguished[ti.min(tj)][ti.max(tj)] {
                        distinguished[i][j] = true;
                        distinguished[j][i] = true;
                        changed = true;
                        break;
                    }
                }
            }
        }
        if !changed {
            break;
        }
    }
    (0..n).all(|i| (0..n).filter(|&j| j != i).all(|j| distinguished[i][j]))
}

/// Same formal-DFA-definition check as `nfa_to_dfa_check.rs`.
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
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../ejercicios/minimizacion")
}

fn save(slug: &str, suffix: &str, doc: &FaDoc) {
    let dir = ejercicios_dir();
    std::fs::create_dir_all(&dir).expect("create ejercicios/minimizacion/ dir");
    std::fs::write(dir.join(format!("{slug}-{suffix}.json")), dto::save_to_string(doc).unwrap())
        .expect("write json");
    let (xml, _report) = writer::export_to_string(doc);
    std::fs::write(dir.join(format!("{slug}-{suffix}.jff")), xml).expect("write jff");
}

struct Exercise {
    slug: &'static str,
    statement: &'static str,
    dfa: FaDoc,
    cases: Vec<(&'static str, bool)>,
    expected_min_states: usize,
}

fn exercises() -> Vec<Exercise> {
    vec![
        Exercise {
            slug: "01-longitud-par-redundante",
            statement: "Cadenas de longitud par sobre {a,b}, construido a propósito con un \
                         ciclo de 4 estados en vez del mínimo de 2 (A y C son equivalentes, \
                         igual que B y D)",
            dfa: build(
                &["A", "B", "C", "D"],
                "A",
                &["A", "C"],
                &[("A", "B", "ab"), ("B", "C", "ab"), ("C", "D", "ab"), ("D", "A", "ab")],
            ),
            cases: vec![
                ("", true), ("aa", true), ("ab", true), ("aaaa", true), ("abab", true),
                ("a", false), ("b", false), ("aaa", false), ("aba", false),
            ],
            expected_min_states: 2,
        },
        Exercise {
            slug: "02-multiplo-3-redundante",
            statement: "Cadenas de longitud multiplo de 3 sobre {a}, construido a propósito con \
                         un ciclo de 6 estados (mod 6) en vez del minimo de 3 (mod 3) — R0~R3, \
                         R1~R4, R2~R5",
            dfa: build(
                &["R0", "R1", "R2", "R3", "R4", "R5"],
                "R0",
                &["R0", "R3"],
                &[
                    ("R0", "R1", "a"), ("R1", "R2", "a"), ("R2", "R3", "a"),
                    ("R3", "R4", "a"), ("R4", "R5", "a"), ("R5", "R0", "a"),
                ],
            ),
            cases: vec![
                ("", true), ("aaa", true), ("aaaaaa", true),
                ("a", false), ("aa", false), ("aaaa", false), ("aaaaa", false), ("aaaaaaa", false),
            ],
            expected_min_states: 3,
        },
        Exercise {
            slug: "03-trampa-explicita-y-final-sin-salida",
            statement: "Cadenas formadas por una o mas letras 'a' y ninguna 'b' (a+), construido \
                         con un estado trampa explicito para 'b' (con auto-bucles) ademas del \
                         estado de aceptacion sin transicion de salida por 'b' — ambos significan \
                         \"rechazar para siempre\" y deben fusionarse en uno solo, que ademas se \
                         descarta (queda implicito, no aparece en el resultado)",
            dfa: build(
                &["q0", "q1", "trampa"],
                "q0",
                &["q1"],
                &[("q0", "q1", "a"), ("q0", "trampa", "b"), ("q1", "q1", "a"), ("trampa", "trampa", "ab")],
            ),
            cases: vec![
                ("a", true), ("aa", true), ("ba", false), ("", false), ("b", false), ("ab", false), ("bb", false),
            ],
            expected_min_states: 2,
        },
    ]
}

fn main() {
    let mut all_ok = true;

    println!("=== Ejercicios construidos con redundancia deliberada ===\n");
    for ex in exercises() {
        println!("{}", ex.statement);

        let mut lang_ok = true;
        for &(word, expected) in &ex.cases {
            let got = accepts(&ex.dfa, word);
            lang_ok &= got == expected;
            if got != expected {
                println!("    FAIL en el AFD original: {word:?} esperado={expected} obtenido={got}");
            }
        }

        let min = minimize_dfa(&ex.dfa).expect("ex.dfa is built deterministic by construction");
        let min_ok = min.states().count() == ex.expected_min_states;
        let minimal_check = is_truly_minimal(&min);
        let formal_violations = formal_dfa_violations(&min);

        let mut min_lang_ok = true;
        for &(word, expected) in &ex.cases {
            let got = accepts(&min, word);
            min_lang_ok &= got == expected;
            if got != expected {
                println!("    FAIL en el AFD minimizado: {word:?} esperado={expected} obtenido={got}");
            }
        }

        let ok = lang_ok && min_ok && minimal_check && formal_violations.is_empty() && min_lang_ok;
        all_ok &= ok;
        println!(
            "  -> {} | {} -> {} estados (esperado {}) | realmente minimo: {} | cumple definicion formal de AFD: {} | lenguaje preservado: {}",
            if ok { "OK" } else { "FALLO" },
            ex.dfa.states().count(),
            min.states().count(),
            ex.expected_min_states,
            if minimal_check { "si" } else { "no" },
            if formal_violations.is_empty() { "si" } else { "no" },
            if min_lang_ok { "si" } else { "no" },
        );

        save(ex.slug, "original", &ex.dfa);
        save(ex.slug, "minimo", &min);
        println!(
            "     guardado: ejercicios/minimizacion/{}-original.{{json,jff}} (abrir el .jff en JFLAP real para comparar) y -minimo.{{json,jff}}\n",
            ex.slug
        );
    }

    println!("=== Re-minimizando AFDs ya producidos en sesiones anteriores ===\n");
    let previously_produced = [
        ("ejercicios/nfa/01-contiene-aa-o-bb-dfa.json", "01-contiene-aa-o-bb"),
        ("ejercicios/nfa/02-cero-o-mas-ab-dfa.json", "02-cero-o-mas-ab"),
        ("ejercicios/nfa/03-antepenultimo-a-dfa.json", "03-antepenultimo-a"),
        ("ejercicios/nfa/04-inicia-a-o-termina-b-dfa.json", "04-inicia-a-o-termina-b"),
        ("ejercicios/teoria-afnd/01-multiplo-2-o-3-afd.json", "teoria-01-multiplo-2-o-3"),
        ("ejercicios/teoria-afnd/02-uno-no-final-afd.json", "teoria-02-uno-no-final"),
    ];
    let repo_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for (rel_path, label) in previously_produced {
        let path = repo_root.join(rel_path);
        let Ok(text) = std::fs::read_to_string(&path) else {
            println!("  (omitido: {rel_path} no existe todavia, correr esa sesion primero)");
            continue;
        };
        let dfa = dto::load_from_str(&text).expect("previously-produced file should be valid native json");
        let min = minimize_dfa(&dfa).expect("previously-produced file should already be a DFA");
        let minimal_check = is_truly_minimal(&min);
        let formal_violations = formal_dfa_violations(&min);
        // sample a handful of short words rather than an exhaustive check
        let mut lang_ok = true;
        for w in ["", "a", "b", "aa", "ab", "ba", "bb", "aaa", "aba", "0", "1", "01", "10", "00", "11"] {
            lang_ok &= accepts(&dfa, w) == accepts(&min, w);
        }
        let ok = minimal_check && formal_violations.is_empty() && lang_ok;
        all_ok &= ok;
        println!(
            "  {label}: {} -> {} estados | {}",
            dfa.states().count(),
            min.states().count(),
            if ok { "OK" } else { "FALLO" }
        );
    }

    if !all_ok {
        eprintln!("\nAl menos un caso fallo.");
        std::process::exit(1);
    }
    println!("\nTodos los ejercicios de minimizacion pasaron.");
}
