//! `.jff` golden fixture tests (design D5, spec domain `jflap-interop`).
//!
//! Fixtures under `tests/fixtures/jff/` are pinned against JFLAP 7.1's own
//! compiled XML writer/reader (see `interop::jff::schema` for provenance —
//! this is a substitute spike, not a GUI-driven export; see the apply
//! report for why). Run: `cargo test -p automata-core --test jff_golden`.

use automata_core::interop::jff::{reader, writer, JffError};
use automata_core::model::fa::Classification;

fn fixture(name: &str) -> String {
    let path = format!("{}/tests/fixtures/jff/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("failed to read fixture {path}: {e}"))
}

// -- 5.3: import fixture -> Document match -----------------------------

#[test]
fn imports_dfa_fixture_as_a_deterministic_automaton() {
    let (doc, report) = reader::import_str(&fixture("dfa.jff")).expect("dfa.jff should import");
    assert_eq!(doc.states().count(), 3);
    assert_eq!(doc.classify(), Classification::Dfa);
    let q0 = doc.symbol_label_to_id("q0"); // states aren't symbols; sanity: this must be None
    assert!(q0.is_none());

    let q0 = state_by_label(&doc, "q0");
    let q1 = state_by_label(&doc, "q1");
    let q2 = state_by_label(&doc, "q2");
    assert_eq!(doc.initial_state(), Some(q0));
    assert!(!doc.is_accepting(q0));
    assert!(!doc.is_accepting(q1));
    assert!(doc.is_accepting(q2));

    let a = doc.symbol_label_to_id("a").expect("symbol 'a' interned");
    let b = doc.symbol_label_to_id("b").expect("symbol 'b' interned");
    assert!(doc.edge(q0, q1).unwrap().symbols.contains(&a));
    assert!(doc.edge(q0, q0).unwrap().symbols.contains(&b));
    assert!(report.is_empty(), "a clean DFA import should carry no loss items: {report:?}");
}

#[test]
fn imports_eps_nfa_fixture_with_epsilon_edge_and_nfa_classification() {
    let (doc, _report) = reader::import_str(&fixture("eps_nfa.jff")).expect("eps_nfa.jff should import");
    assert_eq!(doc.classify(), Classification::Nfa);
    let q0 = state_by_label(&doc, "q0");
    let q1 = state_by_label(&doc, "q1");
    assert!(doc.edge(q0, q1).unwrap().epsilon);
}

#[test]
fn imports_multi_char_symbol_fixture_as_one_atomic_symbol_and_reports_it() {
    let (doc, report) = reader::import_str(&fixture("multi_char_symbol.jff")).unwrap();
    let q0 = state_by_label(&doc, "q0");
    let q1 = state_by_label(&doc, "q1");
    let sym = doc.symbol_label_to_id("ab").expect("multi-char symbol interned atomically, not split");
    assert!(doc.edge(q0, q1).unwrap().symbols.contains(&sym));
    assert!(
        report
            .items
            .iter()
            .any(|i| matches!(i.code, automata_core::interop::jff::LossCode::MultiCharSymbol)),
        "multi-character read value should be reported: {report:?}"
    );
}

#[test]
fn imports_self_loop_fixture() {
    let (doc, _report) = reader::import_str(&fixture("self_loop.jff")).unwrap();
    let q0 = state_by_label(&doc, "q0");
    assert!(doc.is_accepting(q0));
    assert_eq!(doc.initial_state(), Some(q0));
    let a = doc.symbol_label_to_id("a").unwrap();
    assert!(doc.edge(q0, q0).unwrap().symbols.contains(&a));
}

#[test]
fn imports_unreachable_state_fixture_without_dropping_it() {
    let (doc, _report) = reader::import_str(&fixture("unreachable_state.jff")).unwrap();
    // q2 has no incoming edge from q0 but MUST still be present (spec
    // "Unreachable States Are Visible, Never Hidden or Dropped").
    assert_eq!(doc.states().count(), 3);
    let q2 = state_by_label(&doc, "q2");
    assert!(doc.states().any(|s| s == q2));
}

// -- 5.7: reject non-FA type, no partial document -----------------------

#[test]
fn rejects_non_fa_type_with_a_clear_error_and_no_partial_document() {
    let err = reader::import_str(&fixture("reject_pda.jff")).unwrap_err();
    match err {
        JffError::UnsupportedType { found } => assert_eq!(found, "pda"),
        other => panic!("expected UnsupportedType, got {other:?}"),
    }
}

// -- 5.8: malformed/missing-element files fail clean --------------------

#[test]
fn rejects_state_missing_id_attribute() {
    let err = reader::import_str(&fixture("malformed_missing_id.jff")).unwrap_err();
    assert!(matches!(err, JffError::Malformed(_)), "got {err:?}");
}

#[test]
fn rejects_not_well_formed_xml() {
    let err = reader::import_str(&fixture("malformed_bad_xml.jff")).unwrap_err();
    assert!(matches!(err, JffError::NotWellFormed(_)), "got {err:?}");
}

// -- Threat matrix: untrusted `.jff` XML must never expand entities -----

#[test]
fn does_not_expand_external_entities_xxe() {
    // Either the DOCTYPE/ENTITY is ignored (quick-xml has no DTD entity
    // subset parser at all) or the unresolved `&xxe;` reference is a clean
    // parse error — either way, /etc/passwd content must never appear in
    // the result, and the process must not attempt any filesystem access
    // driven by the file's own content.
    match reader::import_str(&fixture("xxe_attempt.jff")) {
        Ok((doc, _report)) => {
            for id in doc.states() {
                let label = doc.state_label(id).unwrap_or("");
                assert!(
                    !label.contains("root:"),
                    "external entity was expanded into document content: {label:?}"
                );
            }
        }
        Err(_) => { /* clean rejection is also an acceptable safe outcome */ }
    }
}

// -- 5.5: import -> export -> import semantic stability ------------------
// (writer.rs is implemented in task 5.6; these are written now as part of
// the same RED batch and will fail to compile/run until 5.6 lands.)

#[test]
fn round_trips_dfa_fixture_through_export_and_reimport() {
    round_trip("dfa.jff");
}

#[test]
fn round_trips_eps_nfa_fixture_through_export_and_reimport() {
    round_trip("eps_nfa.jff");
}

#[test]
fn round_trips_multi_char_symbol_fixture_through_export_and_reimport() {
    round_trip("multi_char_symbol.jff");
}

#[test]
fn round_trips_self_loop_fixture_through_export_and_reimport() {
    round_trip("self_loop.jff");
}

#[test]
fn round_trips_unreachable_state_fixture_through_export_and_reimport() {
    round_trip("unreachable_state.jff");
}

fn round_trip(fixture_name: &str) {
    let (doc, _import_report) = reader::import_str(&fixture(fixture_name)).unwrap();
    let (xml, _export_report) = writer::export_to_string(&doc);
    let (reimported, _reimport_report) = reader::import_str(&xml).unwrap();
    assert_eq!(
        automata_core::dto::fa_to_dto(&doc),
        automata_core::dto::fa_to_dto(&reimported),
        "import -> export -> import must be a semantic identity for {fixture_name}"
    );
}

// -- 5.9: report.rs / all LossCode variants -----------------------------

use automata_core::interop::jff::LossCode;

fn has_code(report: &automata_core::interop::jff::InteropReport, code: LossCode) -> bool {
    report.items.iter().any(|i| i.code == code)
}

#[test]
fn reports_multiple_initial_states_and_keeps_the_last_one() {
    let (doc, report) = reader::import_str(&fixture("multiple_initial_states.jff")).unwrap();
    assert!(has_code(&report, LossCode::MultipleInitialStates), "{report:?}");
    let q1 = state_by_label(&doc, "q1");
    assert_eq!(doc.initial_state(), Some(q1), "last <initial/> parsed should win");
}

#[test]
fn reports_no_initial_state_on_import() {
    let (_doc, report) = reader::import_str(&fixture("no_initial_state.jff")).unwrap();
    assert!(has_code(&report, LossCode::NoInitialState), "{report:?}");
}

#[test]
fn reports_no_initial_state_on_export() {
    let (doc, _import_report) = reader::import_str(&fixture("no_initial_state.jff")).unwrap();
    let (_xml, export_report) = writer::export_to_string(&doc);
    assert!(has_code(&export_report, LossCode::NoInitialState), "{export_report:?}");
}

#[test]
fn reports_and_disambiguates_duplicate_state_names() {
    let (doc, report) = reader::import_str(&fixture("duplicate_state_name.jff")).unwrap();
    assert!(has_code(&report, LossCode::DuplicateStateName), "{report:?}");
    // Both states must still be present, under distinct names.
    let labels: std::collections::BTreeSet<String> = doc
        .states()
        .map(|id| doc.state_label(id).unwrap().to_string())
        .collect();
    assert_eq!(labels.len(), 2, "duplicate name must be disambiguated, not merged/dropped: {labels:?}");
    assert!(labels.contains("q0"));
}

#[test]
fn reports_unknown_elements_without_failing_import() {
    let (doc, report) = reader::import_str(&fixture("unknown_element.jff")).unwrap();
    assert!(has_code(&report, LossCode::UnknownElementDropped), "{report:?}");
    // The state itself must still import correctly despite the unknown
    // <label> child and the unknown top-level <note> element.
    let q0 = state_by_label(&doc, "q0");
    assert!(doc.is_accepting(q0));
    assert_eq!(doc.initial_state(), Some(q0));
}

#[test]
fn reports_geometry_defaulted_when_a_coordinate_is_unparseable() {
    let (doc, report) = reader::import_str(&fixture("geometry_defaulted.jff")).unwrap();
    assert!(has_code(&report, LossCode::GeometryDefaulted), "{report:?}");
    let q0 = state_by_label(&doc, "q0");
    assert_eq!(doc.state_meta(q0).unwrap().x, 0.0, "unparseable x should default to 0.0, not abort the import");
}

fn state_by_label(doc: &automata_core::model::fa::FaDoc, label: &str) -> automata_core::ids::StateId {
    doc.states()
        .find(|&id| doc.state_label(id) == Some(label))
        .unwrap_or_else(|| panic!("no state labeled {label:?}"))
}
