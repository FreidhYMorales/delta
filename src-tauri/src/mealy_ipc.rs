//! IPC-facing DTOs and patch/diff machinery for `MealyDoc` — same shape and
//! rules as `ipc.rs` (design D3: every mutation returns a diff, a full
//! snapshot only on open/import or resync), genuinely mirrored rather than
//! shared, for the same reason `MealyDoc` is its own type instead of an
//! `FaDoc` extension (docs/decisions.md, the Mealy "option B" entry).
//!
//! Differences from `ipc.rs`, all traceable straight back to
//! `model::mealy::MealyDoc`'s own shape:
//!  - No `accepting` on `StateView` — `MealyStateMeta` doesn't have one.
//!  - `EdgeView.transitions: Vec<(String, String)>` (input, output pairs)
//!    instead of `epsilon: bool` + `symbols: Vec<String>` — a Mealy edge is
//!    a small map, not a flat symbol set.
//!  - `Derived` carries `input_alphabet`/`output_alphabet` (two, inferred
//!    separately) and `deterministic: bool` instead of one `alphabet` and
//!    a `classification: "Dfa"|"Nfa"` string — Mealy determinism is
//!    boolean (`MealyDoc::is_deterministic`), there's no NFA-shaped middle
//!    ground the way FA's DFA/NFA classification has.
//!  - `DocPatch::StateInitialSet { id, initial }` replaces
//!    `StateFlagsSet { id, initial, accepting }` — only one per-state flag
//!    exists here.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use automata_core::ids::StateId;
use automata_core::mealy_doc::MealyEditOp;
use automata_core::model::mealy::MealyDoc;

/// Wire-facing mirror of `MealyEditOp` — same "no inverse-only variant
/// exposed" rule as `ipc::EditOpDto` (`RestoreState` stays undo/redo
/// internal, reconstructed by `MealyDocument::undo`/`redo` themselves).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op")]
pub enum MealyEditOpDto {
    AddState { label: String, x: f64, y: f64 },
    RemoveState { id: u32 },
    MoveState { id: u32, x: f64, y: f64 },
    RenameState { id: u32, label: String },
    SetInitial { id: Option<u32> },
    SetTransitions { from: u32, to: u32, entries: Vec<(String, String)> },
}

impl MealyEditOpDto {
    pub fn into_core(self) -> MealyEditOp {
        match self {
            MealyEditOpDto::AddState { label, x, y } => MealyEditOp::AddState { label, x, y },
            MealyEditOpDto::RemoveState { id } => MealyEditOp::RemoveState { id: StateId(id) },
            MealyEditOpDto::MoveState { id, x, y } => MealyEditOp::MoveState { id: StateId(id), x, y },
            MealyEditOpDto::RenameState { id, label } => MealyEditOp::RenameState { id: StateId(id), label },
            MealyEditOpDto::SetInitial { id } => MealyEditOp::SetInitial { id: id.map(StateId) },
            MealyEditOpDto::SetTransitions { from, to, entries } => {
                MealyEditOp::SetTransitions { from: StateId(from), to: StateId(to), entries }
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MealyStateView {
    pub id: u32,
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub initial: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MealyEdgeView {
    pub from: u32,
    pub to: u32,
    pub transitions: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MealyDerived {
    pub input_alphabet: Vec<String>,
    pub output_alphabet: Vec<String>,
    pub deterministic: bool,
    pub unreachable: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MealyDocSnapshot {
    pub revision: u64,
    pub states: Vec<MealyStateView>,
    pub edges: Vec<MealyEdgeView>,
    pub derived: MealyDerived,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "patch")]
pub enum MealyDocPatch {
    StateAdded { id: u32, label: String, x: f64, y: f64 },
    StateRemoved { id: u32 },
    StateMoved { id: u32, x: f64, y: f64 },
    StateRenamed { id: u32, label: String },
    StateInitialSet { id: u32, initial: bool },
    EdgeTransitionsSet { from: u32, to: u32, entries: Vec<(String, String)> },
    EdgeRemoved { from: u32, to: u32 },
    AlphabetSet { input: Vec<String>, output: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MealyEditResult {
    pub revision: u64,
    pub patches: Vec<MealyDocPatch>,
    pub derived: MealyDerived,
}

pub fn snapshot_of(doc: &automata_core::mealy_doc::MealyDocument) -> MealyDocSnapshot {
    MealyDocSnapshot {
        revision: doc.revision,
        states: state_views(&doc.model),
        edges: edge_views(&doc.model),
        derived: derived_of(&doc.model),
    }
}

fn state_views(model: &MealyDoc) -> Vec<MealyStateView> {
    let initial = model.initial_state();
    let mut views: Vec<MealyStateView> = model
        .states()
        .map(|id| {
            let meta = model.state_meta(id).expect("alive state has meta");
            MealyStateView {
                id: id.0,
                label: model.state_label(id).unwrap_or("").to_string(),
                x: meta.x,
                y: meta.y,
                initial: initial == Some(id),
            }
        })
        .collect();
    views.sort_by_key(|s| s.id);
    views
}

fn edge_views(model: &MealyDoc) -> Vec<MealyEdgeView> {
    let mut views: Vec<MealyEdgeView> = model
        .edges()
        .map(|((from, to), transitions)| {
            let mut entries: Vec<(String, String)> = transitions
                .iter()
                .filter_map(|(input, output)| {
                    let input_label = model.input_symbol_label(*input)?;
                    let output_label = model.output_symbol_label(*output)?;
                    Some((input_label.to_string(), output_label.to_string()))
                })
                .collect();
            entries.sort();
            MealyEdgeView { from: from.0, to: to.0, transitions: entries }
        })
        .collect();
    views.sort_by_key(|e| (e.from, e.to));
    views
}

fn sorted_input_alphabet(model: &MealyDoc) -> Vec<String> {
    let mut alphabet: Vec<String> =
        model.input_alphabet().iter().filter_map(|s| model.input_symbol_label(*s).map(str::to_string)).collect();
    alphabet.sort();
    alphabet
}

fn sorted_output_alphabet(model: &MealyDoc) -> Vec<String> {
    let mut alphabet: Vec<String> = model
        .output_alphabet()
        .iter()
        .filter_map(|s| model.output_symbol_label(*s).map(str::to_string))
        .collect();
    alphabet.sort();
    alphabet
}

/// Same BFS-over-the-edit-facing-doc shape as `ipc::unreachable_states`.
fn unreachable_states(model: &MealyDoc) -> Vec<u32> {
    use std::collections::{HashSet, VecDeque};

    let all: Vec<StateId> = model.states().collect();
    let Some(start) = model.initial_state() else {
        let mut ids: Vec<u32> = all.iter().map(|s| s.0).collect();
        ids.sort();
        return ids;
    };

    let mut visited: HashSet<StateId> = HashSet::new();
    let mut queue: VecDeque<StateId> = VecDeque::new();
    visited.insert(start);
    queue.push_back(start);
    while let Some(cur) = queue.pop_front() {
        for ((from, to), _) in model.edges() {
            if *from == cur && visited.insert(*to) {
                queue.push_back(*to);
            }
        }
    }

    let mut unreachable: Vec<u32> = all.iter().filter(|id| !visited.contains(id)).map(|id| id.0).collect();
    unreachable.sort();
    unreachable
}

pub(crate) fn derived_of(model: &MealyDoc) -> MealyDerived {
    MealyDerived {
        input_alphabet: sorted_input_alphabet(model),
        output_alphabet: sorted_output_alphabet(model),
        deterministic: model.is_deterministic(),
        unreachable: unreachable_states(model),
    }
}

#[derive(Clone)]
struct StateSnap {
    label: String,
    x: f64,
    y: f64,
    initial: bool,
}

fn snapshot_states(model: &MealyDoc) -> BTreeMap<u32, StateSnap> {
    let initial = model.initial_state();
    model
        .states()
        .map(|id| {
            let meta = model.state_meta(id).expect("alive state has meta");
            (id.0, StateSnap { label: model.state_label(id).unwrap_or("").to_string(), x: meta.x, y: meta.y, initial: initial == Some(id) })
        })
        .collect()
}

#[derive(Clone, PartialEq)]
struct EdgeSnap {
    entries: Vec<(String, String)>,
}

fn snapshot_edges(model: &MealyDoc) -> BTreeMap<(u32, u32), EdgeSnap> {
    model
        .edges()
        .map(|((from, to), transitions)| {
            let mut entries: Vec<(String, String)> = transitions
                .iter()
                .filter_map(|(input, output)| {
                    let input_label = model.input_symbol_label(*input)?;
                    let output_label = model.output_symbol_label(*output)?;
                    Some((input_label.to_string(), output_label.to_string()))
                })
                .collect();
            entries.sort();
            ((from.0, to.0), EdgeSnap { entries })
        })
        .collect()
}

/// The core IPC diff for Mealy — same role as `ipc::diff_patches`: the
/// minimal `MealyDocPatch` sequence turning `before` into `after`.
pub fn diff_patches(before: &MealyDoc, after: &MealyDoc) -> Vec<MealyDocPatch> {
    let mut patches = Vec::new();

    let before_states = snapshot_states(before);
    let after_states = snapshot_states(after);

    for (&id, a) in &after_states {
        match before_states.get(&id) {
            None => {
                patches.push(MealyDocPatch::StateAdded { id, label: a.label.clone(), x: a.x, y: a.y });
                if a.initial {
                    patches.push(MealyDocPatch::StateInitialSet { id, initial: true });
                }
            }
            Some(b) => {
                if b.label != a.label {
                    patches.push(MealyDocPatch::StateRenamed { id, label: a.label.clone() });
                }
                if b.x != a.x || b.y != a.y {
                    patches.push(MealyDocPatch::StateMoved { id, x: a.x, y: a.y });
                }
                if b.initial != a.initial {
                    patches.push(MealyDocPatch::StateInitialSet { id, initial: a.initial });
                }
            }
        }
    }
    for &id in before_states.keys() {
        if !after_states.contains_key(&id) {
            patches.push(MealyDocPatch::StateRemoved { id });
        }
    }

    let before_edges = snapshot_edges(before);
    let after_edges = snapshot_edges(after);

    for (&(from, to), a) in &after_edges {
        let changed = match before_edges.get(&(from, to)) {
            None => true,
            Some(b) => b != a,
        };
        if changed {
            patches.push(MealyDocPatch::EdgeTransitionsSet { from, to, entries: a.entries.clone() });
        }
    }
    for &(from, to) in before_edges.keys() {
        if !after_edges.contains_key(&(from, to)) {
            patches.push(MealyDocPatch::EdgeRemoved { from, to });
        }
    }

    let before_input = sorted_input_alphabet(before);
    let after_input = sorted_input_alphabet(after);
    let before_output = sorted_output_alphabet(before);
    let after_output = sorted_output_alphabet(after);
    if before_input != after_input || before_output != after_output {
        patches.push(MealyDocPatch::AlphabetSet { input: after_input, output: after_output });
    }

    patches
}

/// A minimal patch-applying mirror proving the resync invariant
/// structurally — same role as `ipc::DocMirror` (see
/// `tests/mealy_resync_invariant.rs`, mirroring `tests/resync_invariant.rs`).
#[derive(Debug, Clone, Default)]
pub struct MealyDocMirror {
    states: BTreeMap<u32, MealyStateView>,
    edges: BTreeMap<(u32, u32), MealyEdgeView>,
}

impl MealyDocMirror {
    pub fn from_snapshot(snapshot: &MealyDocSnapshot) -> Self {
        MealyDocMirror {
            states: snapshot.states.iter().map(|s| (s.id, s.clone())).collect(),
            edges: snapshot.edges.iter().map(|e| ((e.from, e.to), e.clone())).collect(),
        }
    }

    pub fn apply(&mut self, patches: &[MealyDocPatch]) {
        for patch in patches {
            match patch {
                MealyDocPatch::StateAdded { id, label, x, y } => {
                    self.states.insert(*id, MealyStateView { id: *id, label: label.clone(), x: *x, y: *y, initial: false });
                }
                MealyDocPatch::StateRemoved { id } => {
                    self.states.remove(id);
                }
                MealyDocPatch::StateMoved { id, x, y } => {
                    if let Some(s) = self.states.get_mut(id) {
                        s.x = *x;
                        s.y = *y;
                    }
                }
                MealyDocPatch::StateRenamed { id, label } => {
                    if let Some(s) = self.states.get_mut(id) {
                        s.label = label.clone();
                    }
                }
                MealyDocPatch::StateInitialSet { id, initial } => {
                    if let Some(s) = self.states.get_mut(id) {
                        s.initial = *initial;
                    }
                }
                MealyDocPatch::EdgeTransitionsSet { from, to, entries } => {
                    self.edges.insert((*from, *to), MealyEdgeView { from: *from, to: *to, transitions: entries.clone() });
                }
                MealyDocPatch::EdgeRemoved { from, to } => {
                    self.edges.remove(&(*from, *to));
                }
                MealyDocPatch::AlphabetSet { .. } => {}
            }
        }
    }

    pub fn states_sorted(&self) -> Vec<MealyStateView> {
        self.states.values().cloned().collect()
    }

    pub fn edges_sorted(&self) -> Vec<MealyEdgeView> {
        self.edges.values().cloned().collect()
    }
}
