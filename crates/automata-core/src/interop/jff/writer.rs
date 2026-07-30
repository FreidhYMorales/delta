//! [`FaDoc`] -> [`schema::JffFile`] -> `.jff` XML (design D5, task 5.6).
//!
//! Per-symbol unfold: `FaDoc`'s edit-facing edges are pair-grouped (one
//! `(from, to)` key holding a whole [`crate::model::fa::SymbolSet`]), but
//! real JFLAP `.jff` files use one `<transition>` element per symbol (see
//! `AutomatonTransducer.createTransitionElement`/`FSATransducer` in
//! `schema.rs`'s provenance doc comment: `FSATransition` stores exactly one
//! `String` label). Exporting therefore unfolds each edge's symbol set back
//! into one `<transition>` per symbol (plus one more for epsilon, if set).

use std::collections::HashMap;

use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event};
use quick_xml::Writer as QWriter;

use crate::ids::StateId;
use crate::interop::jff::report::{Direction, InteropReport, LossCode, Severity, Subject};
use crate::interop::jff::schema::{JffAutomaton, JffFile, JffState, JffTransition, FA_TYPE};
use crate::model::fa::FaDoc;

/// Project an `FaDoc` into the `.jff` schema. State ids are reindexed
/// densely and deterministically (arena/allocation order), independent of
/// any internal, session-scoped `StateId` numbering (same rationale as
/// `dto.rs`'s positional indices).
pub fn to_jff(doc: &FaDoc) -> (JffFile, InteropReport) {
    let mut report = InteropReport::new(Direction::Export);

    let states: Vec<StateId> = doc.states().collect();
    let index_of: HashMap<StateId, u32> =
        states.iter().enumerate().map(|(i, &id)| (id, i as u32)).collect();

    let states_out: Vec<JffState> = states
        .iter()
        .map(|&sid| {
            let meta = doc.state_meta(sid).expect("alive state has meta");
            JffState {
                id: index_of[&sid],
                name: Some(doc.state_label(sid).expect("alive state has label").to_string()),
                x: meta.x,
                y: meta.y,
                initial: doc.initial_state() == Some(sid),
                r#final: meta.accepting,
            }
        })
        .collect();

    if doc.initial_state().is_none() && !states.is_empty() {
        report.push(
            Severity::Info,
            LossCode::NoInitialState,
            Subject::Document,
            "document has no initial state; exported `.jff` has no `<initial/>` marker",
        );
    }

    let mut edges: Vec<_> = doc.edges().collect();
    edges.sort_by_key(|((from, to), _)| (index_of[from], index_of[to]));

    let mut transitions_out = Vec::new();
    for ((from, to), set) in edges {
        let from_idx = index_of[from];
        let to_idx = index_of[to];
        if set.epsilon {
            transitions_out.push(JffTransition { from: from_idx, to: to_idx, read: Some(String::new()) });
        }
        let mut symbols: Vec<String> =
            set.symbols.iter().map(|s| doc.symbol_label(*s).expect("interned symbol has label").to_string()).collect();
        symbols.sort();
        for sym in symbols {
            transitions_out.push(JffTransition { from: from_idx, to: to_idx, read: Some(sym) });
        }
    }

    let file = JffFile {
        r#type: FA_TYPE.to_string(),
        automaton: JffAutomaton { states: states_out, transitions: transitions_out },
    };
    (file, report)
}

/// Serialize a `.jff` schema value to XML text, matching the structure
/// JFLAP 7.1's own writer produces (tab indentation, matching
/// `DOMPrettier.INDENT`; see `schema.rs` for provenance).
pub fn serialize_jff(file: &JffFile) -> String {
    let mut writer = QWriter::new_with_indent(Vec::new(), b'\t', 1);

    writer
        .write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), Some("no"))))
        .expect("writing to an in-memory Vec<u8> cannot fail");

    write_start(&mut writer, "structure", &[]);
    write_text_elem(&mut writer, "type", &file.r#type);

    write_start(&mut writer, "automaton", &[]);
    for s in &file.automaton.states {
        let id_str = s.id.to_string();
        let mut attrs: Vec<(&str, &str)> = vec![("id", id_str.as_str())];
        if let Some(name) = &s.name {
            attrs.push(("name", name.as_str()));
        }
        write_start(&mut writer, "state", &attrs);
        write_text_elem(&mut writer, "x", &format_coord(s.x));
        write_text_elem(&mut writer, "y", &format_coord(s.y));
        if s.initial {
            write_empty(&mut writer, "initial");
        }
        if s.r#final {
            write_empty(&mut writer, "final");
        }
        write_end(&mut writer, "state");
    }
    for t in &file.automaton.transitions {
        write_start(&mut writer, "transition", &[]);
        write_text_elem(&mut writer, "from", &t.from.to_string());
        write_text_elem(&mut writer, "to", &t.to.to_string());
        match t.read.as_deref() {
            Some(sym) if !sym.is_empty() => write_text_elem(&mut writer, "read", sym),
            _ => write_empty(&mut writer, "read"),
        }
        write_end(&mut writer, "transition");
    }
    write_end(&mut writer, "automaton");
    write_end(&mut writer, "structure");

    String::from_utf8(writer.into_inner()).expect("quick-xml only emits valid UTF-8 for str/String input")
}

pub fn export_to_string(doc: &FaDoc) -> (String, InteropReport) {
    let (file, report) = to_jff(doc);
    (serialize_jff(&file), report)
}

fn format_coord(v: f64) -> String {
    v.to_string()
}

fn write_start(writer: &mut QWriter<Vec<u8>>, name: &str, attrs: &[(&str, &str)]) {
    let mut start = BytesStart::new(name);
    for (k, v) in attrs {
        start.push_attribute((*k, *v));
    }
    writer.write_event(Event::Start(start)).expect("writing to an in-memory Vec<u8> cannot fail");
}

fn write_end(writer: &mut QWriter<Vec<u8>>, name: &str) {
    writer.write_event(Event::End(BytesEnd::new(name))).expect("writing to an in-memory Vec<u8> cannot fail");
}

fn write_empty(writer: &mut QWriter<Vec<u8>>, name: &str) {
    writer.write_event(Event::Empty(BytesStart::new(name))).expect("writing to an in-memory Vec<u8> cannot fail");
}

fn write_text_elem(writer: &mut QWriter<Vec<u8>>, name: &str, text: &str) {
    write_start(writer, name, &[]);
    writer.write_event(Event::Text(BytesText::new(text))).expect("writing to an in-memory Vec<u8> cannot fail");
    write_end(writer, name);
}
