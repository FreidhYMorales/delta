//! Builds and self-verifies 12 DFAs against course-style language
//! statements (see `ejercicios/README.md`), then saves each as a native
//! `.json` document under `ejercicios/` so they can be reopened with
//! `automata-cli inspect`/`sim` or, eventually, the GUI.
//!
//! Run with: `cargo run -p automata-cli --example exercises`

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use automata_core::dto;
use automata_core::engine::fa::FaEngine;
use automata_core::engine::{run_bounded, Budget, Outcome};
use automata_core::model::fa::FaDoc;

/// Build an `FaDoc` from a compact spec: state labels, the initial state,
/// accepting states, and edges as `(from, to, symbols)` where `symbols` is a
/// string of single-char symbols sharing that (from, to) pair (e.g. `"01"`
/// for a transition on both `0` and `1`, matching "any symbol" fan-out).
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

/// Run every `(word, expected_accept)` case against `doc`, printing
/// PASS/FAIL per case. Returns whether every case in the table matched.
fn check(doc: &FaDoc, cases: &[(&str, bool)]) -> bool {
    let engine = FaEngine::compile(doc);
    let mut all_ok = true;
    for &(word, expect_accept) in cases {
        let input: Vec<_> = word.chars().map(|c| doc.symbol_label_to_id(&c.to_string()).unwrap()).collect();
        let outcome = run_bounded(&engine, &input, Budget::default()).outcome;
        let accepted = outcome == Outcome::Accepted;
        let ok = accepted == expect_accept;
        all_ok &= ok;
        let shown = if word.is_empty() { "ε" } else { word };
        println!(
            "    {}  {:<10} esperado={:<5} obtenido={:<5}{}",
            if ok { "OK  " } else { "FAIL" },
            shown,
            expect_accept,
            accepted,
            if ok { "" } else { "  <<<" }
        );
    }
    all_ok
}

fn ejercicios_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../ejercicios")
}

fn save(slug: &str, doc: &FaDoc) {
    let dir = ejercicios_dir();
    std::fs::create_dir_all(&dir).expect("create ejercicios/ dir");
    let path = dir.join(format!("{slug}.json"));
    std::fs::write(&path, dto::save_to_string(doc).unwrap()).expect("write exercise json");
}

struct Exercise {
    slug: &'static str,
    statement: &'static str,
    doc: FaDoc,
    cases: Vec<(&'static str, bool)>,
}

fn exercises() -> Vec<Exercise> {
    vec![
        Exercise {
            slug: "01-inicia0-termina1",
            statement: "1. Cadenas que inicien con 0 y finalicen con 1",
            doc: build(
                &["q0", "qDead", "qB", "qA"],
                "q0",
                &["qA"],
                &[
                    ("q0", "qB", "0"), ("q0", "qDead", "1"),
                    ("qB", "qB", "0"), ("qB", "qA", "1"),
                    ("qA", "qB", "0"), ("qA", "qA", "1"),
                    ("qDead", "qDead", "01"),
                ],
            ),
            cases: vec![
                ("01", true), ("0101", true), ("011", true),
                ("0", false), ("1", false), ("", false),
                ("0100", false), ("0110", false), ("1001", false), ("00", false),
            ],
        },
        Exercise {
            slug: "02-termina-11",
            statement: "2. Cadenas que finalicen en 11",
            doc: build(
                &["qA", "qB", "qC"],
                "qA",
                &["qC"],
                &[
                    ("qA", "qA", "0"), ("qA", "qB", "1"),
                    ("qB", "qA", "0"), ("qB", "qC", "1"),
                    ("qC", "qA", "0"), ("qC", "qC", "1"),
                ],
            ),
            cases: vec![
                ("11", true), ("011", true), ("111", true), ("1011", true),
                ("", false), ("1", false), ("110", false), ("1101", false), ("00", false),
            ],
        },
        Exercise {
            slug: "03-contiene-10",
            statement: "3. Cadenas que contengan la subcadena 10",
            doc: build(
                &["qStart", "qPending", "qFound"],
                "qStart",
                &["qFound"],
                &[
                    ("qStart", "qStart", "0"), ("qStart", "qPending", "1"),
                    ("qPending", "qFound", "0"), ("qPending", "qPending", "1"),
                    ("qFound", "qFound", "01"),
                ],
            ),
            cases: vec![
                ("10", true), ("110", true), ("0110", true), ("1000", true),
                ("01", false), ("0", false), ("1", false), ("11", false),
                ("111", false), ("0001", false),
            ],
        },
        Exercise {
            slug: "04-prefijo-01",
            statement: "4. Cadenas con prefijo 01",
            doc: build(
                &["q0", "qAfter0", "qDead", "qAccept"],
                "q0",
                &["qAccept"],
                &[
                    ("q0", "qAfter0", "0"), ("q0", "qDead", "1"),
                    ("qAfter0", "qAccept", "1"), ("qAfter0", "qDead", "0"),
                    ("qAccept", "qAccept", "01"), ("qDead", "qDead", "01"),
                ],
            ),
            cases: vec![
                ("01", true), ("010", true), ("011", true),
                ("00", false), ("10", false), ("0", false), ("1", false), ("", false),
            ],
        },
        Exercise {
            slug: "05-longitud-par",
            statement: "5. Cadenas con longitud par",
            doc: build(&["qEven", "qOdd"], "qEven", &["qEven"], &[("qEven", "qOdd", "01"), ("qOdd", "qEven", "01")]),
            cases: vec![("", true), ("01", true), ("0101", true), ("0", false), ("010", false)],
        },
        Exercise {
            slug: "06-longitud-multiplo4",
            statement: "6. Cadenas con longitud múltiplo de 4",
            doc: build(
                &["q0", "q1", "q2", "q3"],
                "q0",
                &["q0"],
                &[("q0", "q1", "01"), ("q1", "q2", "01"), ("q2", "q3", "01"), ("q3", "q0", "01")],
            ),
            cases: vec![("", true), ("0000", true), ("01010101", true), ("000", false), ("1", false), ("0101", true)],
        },
        Exercise {
            slug: "07-inicia0-termina1-contiene010",
            statement: "7. Cadenas que inicien con 0, finalicen con 1 y contengan la subcadena 010",
            doc: build(
                &["start", "dead", "s0", "s1", "s2", "f0", "f1"],
                "start",
                &["f1"],
                &[
                    ("start", "s1", "0"), ("start", "dead", "1"),
                    ("dead", "dead", "01"),
                    ("s0", "s1", "0"), ("s0", "s0", "1"),
                    ("s1", "s1", "0"), ("s1", "s2", "1"),
                    ("s2", "f0", "0"), ("s2", "s0", "1"),
                    ("f0", "f0", "0"), ("f0", "f1", "1"),
                    ("f1", "f0", "0"), ("f1", "f1", "1"),
                ],
            ),
            cases: vec![
                ("00101", true), ("0101", true), ("00100101", true),
                ("0010", false), ("01", false), ("0100", false), ("1010", false),
                ("0011", false), ("010", false),
            ],
        },
        Exercise {
            slug: "08-termina-000",
            statement: "8. Cadenas que finalicen en tres ceros",
            doc: build(
                &["qA", "qB", "qC", "qD"],
                "qA",
                &["qD"],
                &[
                    ("qA", "qB", "0"), ("qA", "qA", "1"),
                    ("qB", "qC", "0"), ("qB", "qA", "1"),
                    ("qC", "qD", "0"), ("qC", "qA", "1"),
                    ("qD", "qD", "0"), ("qD", "qA", "1"),
                ],
            ),
            cases: vec![
                ("000", true), ("1000", true), ("0000", true), ("111000", true),
                ("00", false), ("0001", false), ("100010", false), ("0100", false),
            ],
        },
        Exercise {
            slug: "09-contiene101-inicia1",
            statement: "9. Cadenas que acepten la subcadena 101 e inicien con 1",
            doc: build(
                &["start", "dead", "s0", "s1", "s2", "found"],
                "start",
                &["found"],
                &[
                    ("start", "s1", "1"), ("start", "dead", "0"),
                    ("dead", "dead", "01"),
                    ("s0", "s1", "1"), ("s0", "s0", "0"),
                    ("s1", "s1", "1"), ("s1", "s2", "0"),
                    ("s2", "found", "1"), ("s2", "s0", "0"),
                    ("found", "found", "01"),
                ],
            ),
            cases: vec![
                ("101", true), ("1101", true), ("1010", true), ("110101", true),
                ("111", false), ("011", false), ("100", false), ("1001", false), ("1", false),
            ],
        },
        Exercise {
            slug: "10-prefijo01-sufijo10",
            statement: "10. Cadenas con prefijo 01 y sufijo 10",
            doc: build(
                &["start", "afterFirst0", "dead", "ok00", "ok01", "ok10", "ok11"],
                "start",
                &["ok10"],
                &[
                    ("start", "afterFirst0", "0"), ("start", "dead", "1"),
                    ("afterFirst0", "ok01", "1"), ("afterFirst0", "dead", "0"),
                    ("dead", "dead", "01"),
                    ("ok00", "ok00", "0"), ("ok00", "ok01", "1"),
                    ("ok01", "ok10", "0"), ("ok01", "ok11", "1"),
                    ("ok10", "ok00", "0"), ("ok10", "ok01", "1"),
                    ("ok11", "ok10", "0"), ("ok11", "ok11", "1"),
                ],
            ),
            cases: vec![
                ("010", true), ("0110", true), ("011010", true),
                ("01", false), ("0100", false), ("100", false), ("00", false), ("0111", false),
            ],
        },
        Exercise {
            slug: "11-longitud-impar",
            statement: "11. Cadenas con longitud impar",
            doc: build(&["qEven", "qOdd"], "qEven", &["qOdd"], &[("qEven", "qOdd", "01"), ("qOdd", "qEven", "01")]),
            cases: vec![("0", true), ("010", true), ("", false), ("01", false), ("0101", false)],
        },
        Exercise {
            slug: "12-longitud-multiplo3",
            statement: "12. Cadenas con longitud múltiplo de tres",
            doc: build(
                &["q0", "q1", "q2"],
                "q0",
                &["q0"],
                &[("q0", "q1", "01"), ("q1", "q2", "01"), ("q2", "q0", "01")],
            ),
            cases: vec![("", true), ("010", true), ("000000", true), ("001", true), ("01", false), ("0", false)],
        },
    ]
}

fn main() {
    let mut all_ok = true;
    for ex in exercises() {
        println!("{}", ex.statement);
        let ok = check(&ex.doc, &ex.cases);
        save(ex.slug, &ex.doc);
        println!("  -> {} ({} casos) guardado en ejercicios/{}.json\n", if ok { "OK" } else { "FALLÓ" }, ex.cases.len(), ex.slug);
        all_ok &= ok;
    }
    if !all_ok {
        eprintln!("Al menos un ejercicio falló uno o más casos.");
        std::process::exit(1);
    }
    println!("Los 12 ejercicios pasaron todos sus casos.");
}
