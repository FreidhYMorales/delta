//! `.jff` XML -> [`schema::JffFile`] -> [`FaDoc`] (design D5, task 5.4).
//!
//! Uses `quick-xml`'s low-level event `Reader` directly (not its `serde`
//! feature, not a DOM tree) over the file's own `&str` bytes. This is a
//! **hard security property, not a configuration choice**: `quick-xml` has
//! no DTD internal-subset parser and does not implement general/external
//! XML entity expansion at all — a `<!DOCTYPE ...>` is surfaced as a single
//! opaque [`Event::DocType`] that this reader discards unread, and any
//! entity reference in text/attribute content other than the five
//! predefined XML entities (`&amp; &lt; &gt; &apos; &quot;`) or a numeric
//! character reference fails `unescape()`/`unescape_value()` with a clean
//! error instead of being expanded. There is no billion-laughs / XXE attack
//! surface to disable here — see `does_not_expand_external_entities_xxe` in
//! `tests/jff_golden.rs`.

use quick_xml::events::attributes::Attribute;
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

use crate::interop::jff::report::{Direction, InteropReport, LossCode, Severity, Subject};
use crate::interop::jff::schema::{JffAutomaton, JffFile, JffState, JffTransition, FA_TYPE};
use crate::interop::jff::JffError;
use crate::model::fa::FaDoc;

/// Import a `.jff` document from its raw XML text. Never leaves a partial
/// `FaDoc` behind on error (spec "Reject non-FA .jff content", "Malformed
/// file") — the `FaDoc` is only constructed after the whole file has been
/// parsed and its `<type>` confirmed to be `"fa"`.
pub fn import_str(xml: &str) -> Result<(FaDoc, InteropReport), JffError> {
    let mut report = InteropReport::new(Direction::Import);
    let file = parse_jff(xml, &mut report)?;
    if file.r#type != FA_TYPE {
        return Err(JffError::UnsupportedType { found: file.r#type });
    }
    let doc = to_fa_doc(&file, &mut report)?;
    Ok((doc, report))
}

/// Parse raw `.jff` bytes into the intermediate schema, independent of FA
/// semantics (so a non-FA `<type>` can still be parsed structurally and
/// reported with a precise "found X" message rather than a generic XML
/// error).
pub fn parse_jff(xml: &str, report: &mut InteropReport) -> Result<JffFile, JffError> {
    let mut reader = Reader::from_str(xml);

    // Advance past the prolog/comments/doctype to the `<structure>` root.
    loop {
        match reader.read_event().map_err(xml_err)? {
            Event::Start(e) if local_name(&e) == "structure" => break,
            Event::Empty(_) => {
                return Err(JffError::Malformed(
                    "`<structure>` has no children (missing `<type>`/`<automaton>`)".into(),
                ));
            }
            Event::Eof => return Err(JffError::Malformed("missing `<structure>` root element".into())),
            Event::Decl(_) | Event::DocType(_) | Event::Comment(_) | Event::PI(_) | Event::Text(_) => continue,
            other => {
                return Err(JffError::Malformed(format!(
                    "unexpected content before `<structure>`: {other:?}"
                )))
            }
        }
    }

    let mut r#type: Option<String> = None;
    let mut automaton: Option<JffAutomaton> = None;

    loop {
        match reader.read_event().map_err(xml_err)? {
            Event::Start(e) => {
                let name = local_name(&e);
                match name.as_str() {
                    "type" => r#type = Some(read_leaf_text(&mut reader, &e)?),
                    "automaton" => automaton = Some(read_automaton(&mut reader, report)?),
                    other => {
                        report.push(
                            Severity::Info,
                            LossCode::UnknownElementDropped,
                            Subject::Document,
                            format!("unknown element <{other}> inside <structure> was ignored"),
                        );
                        skip_subtree(&mut reader, &e)?;
                    }
                }
            }
            Event::Empty(e) => {
                let name = local_name(&e);
                match name.as_str() {
                    "type" => r#type = Some(String::new()),
                    "automaton" => automaton = Some(JffAutomaton::default()),
                    other => {
                        report.push(
                            Severity::Info,
                            LossCode::UnknownElementDropped,
                            Subject::Document,
                            format!("unknown element <{other}> inside <structure> was ignored"),
                        );
                    }
                }
            }
            Event::End(e) if local_name_end(&e) == "structure" => break,
            Event::Eof => return Err(JffError::Malformed("unexpected end of file inside `<structure>`".into())),
            Event::End(e) => {
                return Err(JffError::Malformed(format!(
                    "unexpected closing tag </{}> inside <structure>",
                    local_name_end(&e)
                )))
            }
            Event::Text(_) | Event::Comment(_) | Event::CData(_) | Event::PI(_) => {}
            Event::Decl(_) | Event::DocType(_) => {}
        }
    }

    let r#type = r#type.ok_or_else(|| JffError::Malformed("missing `<type>` element".into()))?;
    let automaton = automaton.unwrap_or_default();
    Ok(JffFile { r#type, automaton })
}

fn read_automaton(reader: &mut Reader<&[u8]>, report: &mut InteropReport) -> Result<JffAutomaton, JffError> {
    let mut automaton = JffAutomaton::default();
    loop {
        match reader.read_event().map_err(xml_err)? {
            Event::Start(e) => {
                let name = local_name(&e);
                match name.as_str() {
                    "state" => automaton.states.push(read_state(reader, &e, report)?),
                    "transition" => automaton.transitions.push(read_transition(reader, report)?),
                    other => {
                        report.push(
                            Severity::Info,
                            LossCode::UnknownElementDropped,
                            Subject::Document,
                            format!("unknown element <{other}> inside <automaton> was ignored"),
                        );
                        skip_subtree(reader, &e)?;
                    }
                }
            }
            Event::Empty(e) => {
                let name = local_name(&e);
                match name.as_str() {
                    "state" => return Err(JffError::Malformed("State without id attribute encountered!".into())),
                    "transition" => return Err(JffError::Malformed("A transition has no from state!".into())),
                    other => report.push(
                        Severity::Info,
                        LossCode::UnknownElementDropped,
                        Subject::Document,
                        format!("unknown element <{other}> inside <automaton> was ignored"),
                    ),
                }
            }
            Event::End(e) if local_name_end(&e) == "automaton" => break,
            Event::Eof => return Err(JffError::Malformed("unexpected end of file inside <automaton>".into())),
            Event::End(e) => {
                return Err(JffError::Malformed(format!(
                    "unexpected closing tag </{}> inside <automaton>",
                    local_name_end(&e)
                )))
            }
            Event::Text(_) | Event::Comment(_) | Event::CData(_) | Event::PI(_) => {}
            Event::Decl(_) | Event::DocType(_) => {}
        }
    }
    Ok(automaton)
}

fn read_state(
    reader: &mut Reader<&[u8]>,
    start: &BytesStart,
    report: &mut InteropReport,
) -> Result<JffState, JffError> {
    let id_str = get_attr(start, "id")?
        .ok_or_else(|| JffError::Malformed("State without id attribute encountered!".into()))?;
    let id: u32 = id_str
        .parse()
        .map_err(|_| JffError::Malformed(format!("state id {id_str:?} is not a valid non-negative integer")))?;
    let name = get_attr(start, "name")?.filter(|n| !n.is_empty());

    let mut x: Option<f64> = None;
    let mut y: Option<f64> = None;
    let mut initial = false;
    let mut r#final = false;

    loop {
        match reader.read_event().map_err(xml_err)? {
            Event::Start(e) => {
                let name = local_name(&e);
                match name.as_str() {
                    "x" => x = Some(parse_coord(&read_leaf_text(reader, &e)?, id, "x", report)),
                    "y" => y = Some(parse_coord(&read_leaf_text(reader, &e)?, id, "y", report)),
                    "initial" => {
                        initial = true;
                        skip_subtree(reader, &e)?;
                    }
                    "final" => {
                        r#final = true;
                        skip_subtree(reader, &e)?;
                    }
                    other => {
                        report.push(
                            Severity::Info,
                            LossCode::UnknownElementDropped,
                            Subject::State(format!("id={id}")),
                            format!("unknown element <{other}> inside <state> was ignored"),
                        );
                        skip_subtree(reader, &e)?;
                    }
                }
            }
            Event::Empty(e) => {
                let name = local_name(&e);
                match name.as_str() {
                    "initial" => initial = true,
                    "final" => r#final = true,
                    other => report.push(
                        Severity::Info,
                        LossCode::UnknownElementDropped,
                        Subject::State(format!("id={id}")),
                        format!("unknown element <{other}> inside <state> was ignored"),
                    ),
                }
            }
            Event::End(e) if local_name_end(&e) == "state" => break,
            Event::Eof => return Err(JffError::Malformed("unexpected end of file inside <state>".into())),
            Event::End(e) => {
                return Err(JffError::Malformed(format!(
                    "unexpected closing tag </{}> inside <state>",
                    local_name_end(&e)
                )))
            }
            Event::Text(_) | Event::Comment(_) | Event::CData(_) | Event::PI(_) => {}
            Event::Decl(_) | Event::DocType(_) => {}
        }
    }

    let x = x.ok_or_else(|| JffError::Malformed(format!("The x coordinate could not be read for state {id}.")))?;
    let y = y.ok_or_else(|| JffError::Malformed(format!("The y coordinate could not be read for state {id}.")))?;

    Ok(JffState { id, name, x, y, initial, r#final })
}

/// Missing `<x>`/`<y>` is a hard error (matches real JFLAP's own
/// `NullPointerException` -> `DataException` path); present-but-unparseable
/// text defaults to `0.0` and is reported (matches real JFLAP's own
/// `NumberFormatException` -> "unlocated" soft-fail path).
fn parse_coord(text: &str, state_id: u32, axis: &str, report: &mut InteropReport) -> f64 {
    match text.trim().parse::<f64>() {
        Ok(v) => v,
        Err(_) => {
            report.push(
                Severity::Lossy,
                LossCode::GeometryDefaulted,
                Subject::State(format!("id={state_id}")),
                format!("the {axis} coordinate {text:?} could not be read for state {state_id}; defaulted to 0.0"),
            );
            0.0
        }
    }
}

fn read_transition(reader: &mut Reader<&[u8]>, report: &mut InteropReport) -> Result<JffTransition, JffError> {
    let mut from: Option<u32> = None;
    let mut to: Option<u32> = None;
    let mut read: Option<String> = None;

    loop {
        match reader.read_event().map_err(xml_err)? {
            Event::Start(e) => {
                let name = local_name(&e);
                match name.as_str() {
                    "from" => from = Some(parse_state_ref(&read_leaf_text(reader, &e)?, "from")?),
                    "to" => to = Some(parse_state_ref(&read_leaf_text(reader, &e)?, "to")?),
                    "read" => read = Some(read_leaf_text(reader, &e)?),
                    other => {
                        report.push(
                            Severity::Info,
                            LossCode::UnknownElementDropped,
                            Subject::Document,
                            format!("unknown element <{other}> inside <transition> was ignored"),
                        );
                        skip_subtree(reader, &e)?;
                    }
                }
            }
            Event::Empty(e) => {
                let name = local_name(&e);
                match name.as_str() {
                    "read" => read = Some(String::new()),
                    other => report.push(
                        Severity::Info,
                        LossCode::UnknownElementDropped,
                        Subject::Document,
                        format!("unknown element <{other}> inside <transition> was ignored"),
                    ),
                }
            }
            Event::End(e) if local_name_end(&e) == "transition" => break,
            Event::Eof => return Err(JffError::Malformed("unexpected end of file inside <transition>".into())),
            Event::End(e) => {
                return Err(JffError::Malformed(format!(
                    "unexpected closing tag </{}> inside <transition>",
                    local_name_end(&e)
                )))
            }
            Event::Text(_) | Event::Comment(_) | Event::CData(_) | Event::PI(_) => {}
            Event::Decl(_) | Event::DocType(_) => {}
        }
    }

    let from = from.ok_or_else(|| JffError::Malformed("A transition has no from state!".into()))?;
    let to = to.ok_or_else(|| JffError::Malformed("A transition has no to state!".into()))?;
    Ok(JffTransition { from, to, read })
}

fn parse_state_ref(text: &str, which: &str) -> Result<u32, JffError> {
    text.trim()
        .parse()
        .map_err(|_| JffError::Malformed(format!("transition <{which}> value {text:?} is not a valid state id")))
}

/// Convert the parsed schema into an `FaDoc`, resolving JFLAP integer state
/// ids into fresh `StateId`s and appending non-fatal `LossItem`s for
/// anything that could not be represented exactly.
fn to_fa_doc(file: &JffFile, report: &mut InteropReport) -> Result<FaDoc, JffError> {
    use std::collections::HashMap;

    let mut doc = FaDoc::new();
    let mut id_map: HashMap<u32, crate::ids::StateId> = HashMap::new();
    let mut used_names: HashMap<String, u32> = HashMap::new();
    let mut initial_count = 0usize;
    let mut chosen_initial = None;

    for s in &file.automaton.states {
        let default_name = format!("q{}", s.id);
        let mut name = s.name.clone().unwrap_or_else(|| default_name.clone());
        if let Some(&owner_id) = used_names.get(&name) {
            report.push(
                Severity::Lossy,
                LossCode::DuplicateStateName,
                Subject::State(name.clone()),
                format!(
                    "state id {} reused name {name:?} already used by state id {owner_id}; disambiguated",
                    s.id
                ),
            );
            let mut suffix = 2u32;
            let mut candidate = format!("{name}_{suffix}");
            while used_names.contains_key(&candidate) {
                suffix += 1;
                candidate = format!("{name}_{suffix}");
            }
            name = candidate;
        }
        used_names.insert(name.clone(), s.id);

        let sid = doc
            .add_state(&name, s.x, s.y)
            .map_err(|e| JffError::Malformed(format!("could not add state {name:?}: {e}")))?;
        doc.set_accepting(sid, s.r#final);
        id_map.insert(s.id, sid);
        if s.initial {
            initial_count += 1;
            chosen_initial = Some(sid); // last `<initial/>` wins, matching real JFLAP
        }
    }

    match initial_count {
        0 => report.push(
            Severity::Info,
            LossCode::NoInitialState,
            Subject::Document,
            "no state was marked `<initial/>`",
        ),
        1 => {}
        n => report.push(
            Severity::Lossy,
            LossCode::MultipleInitialStates,
            Subject::Document,
            format!(
                "{n} states were marked `<initial/>`; the last one parsed was kept as the sole initial state \
                 (matching JFLAP's own last-write-wins behavior)"
            ),
        ),
    }
    doc.set_initial(chosen_initial);

    for t in &file.automaton.transitions {
        let from = *id_map
            .get(&t.from)
            .ok_or_else(|| JffError::Malformed(format!("A transition is defined from non-existent state {}!", t.from)))?;
        let to = *id_map
            .get(&t.to)
            .ok_or_else(|| JffError::Malformed(format!("A transition is defined to non-existent state {}!", t.to)))?;
        match t.read.as_deref() {
            None | Some("") => doc.add_epsilon_transition(from, to),
            Some(sym) => {
                if sym.chars().count() > 1 {
                    report.push(
                        Severity::Info,
                        LossCode::MultiCharSymbol,
                        Subject::Edge {
                            from: doc.state_label(from).unwrap_or_default().to_string(),
                            to: doc.state_label(to).unwrap_or_default().to_string(),
                        },
                        format!(
                            "transition read value {sym:?} has more than one character; imported as one atomic \
                             symbol (matching JFLAP's own string-equality transition semantics)"
                        ),
                    );
                }
                doc.add_transition(from, to, sym);
            }
        }
    }

    Ok(doc)
}

// -- low-level XML helpers ------------------------------------------------

fn xml_err(e: quick_xml::Error) -> JffError {
    JffError::NotWellFormed(e.to_string())
}

fn local_name(e: &BytesStart) -> String {
    String::from_utf8_lossy(e.local_name().as_ref()).into_owned()
}

fn local_name_end(e: &quick_xml::events::BytesEnd) -> String {
    String::from_utf8_lossy(e.local_name().as_ref()).into_owned()
}

fn get_attr(e: &BytesStart, name: &str) -> Result<Option<String>, JffError> {
    for attr in e.attributes() {
        // A malformed attribute (e.g. an unquoted value) is an XML
        // well-formedness violation, not a JFLAP-schema mismatch.
        let attr: Attribute = attr.map_err(|err| JffError::NotWellFormed(format!("invalid attribute: {err}")))?;
        if attr.key.local_name().as_ref() == name.as_bytes() {
            let value = attr
                .unescape_value()
                .map_err(|err| JffError::NotWellFormed(format!("invalid attribute value for {name:?}: {err}")))?;
            return Ok(Some(value.into_owned()));
        }
    }
    Ok(None)
}

/// Read the text content of a leaf element (one with no child *elements*,
/// e.g. `<x>50.0</x>`) up to its matching end tag. Any nested start tag is
/// treated as a malformed file (real JFLAP's own leaf elements never
/// contain child elements).
fn read_leaf_text(reader: &mut Reader<&[u8]>, start: &BytesStart) -> Result<String, JffError> {
    let mut text = String::new();
    let expected = local_name(start);
    loop {
        match reader.read_event().map_err(xml_err)? {
            Event::Text(t) => {
                let decoded = t
                    .unescape()
                    .map_err(|e| JffError::Malformed(format!("invalid text content in <{expected}>: {e}")))?;
                text.push_str(&decoded);
            }
            Event::CData(t) => {
                text.push_str(&String::from_utf8_lossy(&t.into_inner()));
            }
            Event::End(e) if local_name_end(&e) == expected => break,
            Event::Eof => return Err(JffError::Malformed(format!("unexpected end of file inside <{expected}>"))),
            Event::Start(e) => {
                return Err(JffError::Malformed(format!(
                    "unexpected child element <{}> inside <{expected}>",
                    local_name(&e)
                )))
            }
            Event::Empty(e) => {
                return Err(JffError::Malformed(format!(
                    "unexpected child element <{}> inside <{expected}>",
                    local_name(&e)
                )))
            }
            Event::End(e) => {
                return Err(JffError::Malformed(format!(
                    "mismatched closing tag </{}> inside <{expected}>",
                    local_name_end(&e)
                )))
            }
            Event::Comment(_) | Event::PI(_) => {}
            Event::Decl(_) | Event::DocType(_) => {}
        }
    }
    Ok(text)
}

/// Skip an already-open element's entire subtree, including arbitrarily
/// nested children, up to and including its matching end tag.
fn skip_subtree(reader: &mut Reader<&[u8]>, start: &BytesStart) -> Result<(), JffError> {
    let expected = local_name(start);
    let mut depth = 0u32;
    loop {
        match reader.read_event().map_err(xml_err)? {
            Event::Start(e) if local_name(&e) == expected => depth += 1,
            Event::End(e) if local_name_end(&e) == expected => {
                if depth == 0 {
                    break;
                }
                depth -= 1;
            }
            Event::Eof => return Err(JffError::Malformed(format!("unexpected end of file while skipping <{expected}>"))),
            _ => {}
        }
    }
    Ok(())
}
