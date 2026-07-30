//! Native JSON persistence. The on-disk envelope is `{"version": 1,
//! "document": {"kind": "Fa", ...}}` — the `kind` tag is the serializable
//! boundary enum from design D1 (v1 ships only `Fa`; unknown future kinds or
//! versions fail with a message, never panic).
//!
//! State references in the DTO are positional indices into the `states`
//! array, not raw internal `StateId`s: the arena's id numbering is a
//! session-scoped implementation detail (design D2) that does not need to
//! survive serialization — only the observable structure (labels, geometry,
//! flags, transitions) does.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::ids::StateId;
use crate::model::fa::FaDoc;

pub const CURRENT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum MachineDoc {
    Fa(FaDto),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FaDto {
    pub states: Vec<StateDto>,
    pub edges: Vec<EdgeDto>,
    pub initial: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StateDto {
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub accepting: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EdgeDto {
    pub from: usize,
    pub to: usize,
    pub epsilon: bool,
    pub symbols: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Envelope {
    version: u32,
    document: MachineDoc,
}

#[derive(Debug, thiserror::Error)]
pub enum DtoError {
    #[error("unsupported document version {0} (expected {CURRENT_VERSION})")]
    UnsupportedVersion(u32),
    #[error("state index {0} is out of range")]
    InvalidStateIndex(usize),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

/// Project an `FaDoc` into its serializable DTO. Edges are sorted by
/// endpoint index (and symbols within an edge are sorted) so the same
/// document always serializes to the same bytes, independent of internal
/// `HashMap` iteration order.
pub fn fa_to_dto(doc: &FaDoc) -> FaDto {
    let alive: Vec<StateId> = doc.states().collect();
    let index_of: HashMap<StateId, usize> =
        alive.iter().enumerate().map(|(i, &id)| (id, i)).collect();

    let states = alive
        .iter()
        .map(|&id| {
            let meta = doc.state_meta(id).expect("alive state has meta");
            StateDto {
                label: doc.state_label(id).expect("alive state has label").to_string(),
                x: meta.x,
                y: meta.y,
                accepting: meta.accepting,
            }
        })
        .collect();

    let mut edges: Vec<EdgeDto> = doc
        .edges()
        .map(|((from, to), set)| {
            let mut symbols: Vec<String> = set
                .symbols
                .iter()
                .map(|s| doc.symbol_label(*s).expect("interned symbol has label").to_string())
                .collect();
            symbols.sort();
            EdgeDto {
                from: index_of[from],
                to: index_of[to],
                epsilon: set.epsilon,
                symbols,
            }
        })
        .collect();
    edges.sort_by_key(|e| (e.from, e.to));

    let initial = doc.initial_state().map(|id| index_of[&id]);

    FaDto { states, edges, initial }
}

/// Reconstruct an `FaDoc` from its DTO, allocating fresh `StateId`s in
/// `states` array order.
pub fn fa_from_dto(dto: &FaDto) -> Result<FaDoc, DtoError> {
    let mut doc = FaDoc::new();
    let mut ids = Vec::with_capacity(dto.states.len());
    for s in &dto.states {
        let id = doc
            .add_state(&s.label, s.x, s.y)
            .map_err(|_| DtoError::InvalidStateIndex(ids.len()))?;
        doc.set_accepting(id, s.accepting);
        ids.push(id);
    }
    for e in &dto.edges {
        let from = *ids.get(e.from).ok_or(DtoError::InvalidStateIndex(e.from))?;
        let to = *ids.get(e.to).ok_or(DtoError::InvalidStateIndex(e.to))?;
        for sym in &e.symbols {
            doc.add_transition(from, to, sym);
        }
        if e.epsilon {
            doc.add_epsilon_transition(from, to);
        }
    }
    if let Some(idx) = dto.initial {
        let id = *ids.get(idx).ok_or(DtoError::InvalidStateIndex(idx))?;
        doc.set_initial(Some(id));
    }
    Ok(doc)
}

pub fn save_to_string(doc: &FaDoc) -> Result<String, DtoError> {
    let envelope = Envelope {
        version: CURRENT_VERSION,
        document: MachineDoc::Fa(fa_to_dto(doc)),
    };
    Ok(serde_json::to_string_pretty(&envelope)?)
}

pub fn load_from_str(s: &str) -> Result<FaDoc, DtoError> {
    let envelope: Envelope = serde_json::from_str(s)?;
    if envelope.version != CURRENT_VERSION {
        return Err(DtoError::UnsupportedVersion(envelope.version));
    }
    match envelope.document {
        MachineDoc::Fa(dto) => fa_from_dto(&dto),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn build_doc(
        num_states: usize,
        edge_specs: Vec<(usize, usize, bool, Vec<String>)>,
        initial: Option<usize>,
    ) -> FaDoc {
        let mut doc = FaDoc::new();
        let mut ids = Vec::with_capacity(num_states);
        for i in 0..num_states {
            let id = doc
                .add_state(&format!("s{i}"), i as f64, (i * 2) as f64)
                .unwrap();
            doc.set_accepting(id, i % 3 == 0);
            ids.push(id);
        }
        if num_states > 0 {
            for (from_idx, to_idx, epsilon, symbols) in edge_specs {
                let from = ids[from_idx % num_states];
                let to = ids[to_idx % num_states];
                for sym in &symbols {
                    doc.add_transition(from, to, sym);
                }
                if epsilon {
                    doc.add_epsilon_transition(from, to);
                }
            }
            if let Some(idx) = initial {
                doc.set_initial(Some(ids[idx % num_states]));
            }
        }
        doc
    }

    #[test]
    fn envelope_carries_version_one() {
        let doc = build_doc(1, vec![], None);
        let json = save_to_string(&doc).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["version"].as_u64(), Some(1));
        assert_eq!(value["document"]["kind"].as_str(), Some("Fa"));
    }

    #[test]
    fn unsupported_version_fails_with_a_clear_error() {
        let json = r#"{"version":2,"document":{"kind":"Fa","states":[],"edges":[],"initial":null}}"#;
        let err = load_from_str(json).unwrap_err();
        assert!(matches!(err, DtoError::UnsupportedVersion(2)));
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        /// Save-then-load must be an identity on the document's observable
        /// content (spec: Lossless Native Save/Load).
        #[test]
        fn save_load_round_trip_is_identity(
            num_states in 0usize..12,
            edge_specs in prop::collection::vec(
                (0usize..12, 0usize..12, any::<bool>(), prop::collection::vec("[a-b]", 0..3)),
                0..10,
            ),
            initial in prop::option::of(0usize..12),
        ) {
            let doc = build_doc(num_states, edge_specs, initial);
            let json = save_to_string(&doc).unwrap();
            let reloaded = load_from_str(&json).unwrap();
            prop_assert_eq!(fa_to_dto(&doc), fa_to_dto(&reloaded));
        }
    }
}
