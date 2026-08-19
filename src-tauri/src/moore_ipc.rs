//! IPC-facing DTOs and patch/diff machinery for `MooreDoc` — same shape and
//! rules as `ipc.rs`/`mealy_ipc.rs` (design D3: every mutation returns a
//! diff, a full snapshot only on open/import or resync), genuinely mirrored
//! rather than shared, for the same reason `MooreDoc` is its own type
//! instead of an `FaDoc`/`MealyDoc` extension (docs/decisions.md, the Moore
//! backend entry).
//!
//! Differences from `mealy_ipc.rs`, all traceable straight back to
//! `model::moore::MooreDoc`'s own shape:
//!  - `StateView.output: Option<String>` — Moore output lives on the state,
//!    not the edge, unlike Mealy's per-transition output.
//!  - `EdgeView.transitions` is gone; edges only carry
//!    `inputs: Vec<String>` (plain input symbols, no output pairing).
//!  - `DocPatch` has a `StateOutputSet { id, output }` variant with no
//!    Mealy equivalent (Mealy has no per-state patch besides
//!    `StateInitialSet`), and `EdgeInputsSet` replaces
//!    `EdgeTransitionsSet` (plain input list instead of input/output pairs).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use automata_core::ids::StateId;
use automata_core::model::moore::MooreDoc;
use automata_core::moore_doc::MooreEditOp;

/// Wire-facing mirror of `MooreEditOp` — same "no inverse-only variant
/// exposed" rule as `ipc::EditOpDto`/`mealy_ipc::MealyEditOpDto`
/// (`RestoreState` stays undo/redo internal).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op")]
pub enum MooreEditOpDto {
    AddState { label: String, x: f64, y: f64 },
    RemoveState { id: u32 },
    MoveState { id: u32, x: f64, y: f64 },
    RenameState { id: u32, label: String },
    SetInitial { id: Option<u32> },
    SetOutput { state: u32, output: Option<String> },
    SetTransitions { from: u32, to: u32, inputs: Vec<String> },
}

impl MooreEditOpDto {
    pub fn into_core(self) -> MooreEditOp {
        match self {
            MooreEditOpDto::AddState { label, x, y } => MooreEditOp::AddState { label, x, y },
            MooreEditOpDto::RemoveState { id } => MooreEditOp::RemoveState { id: StateId(id) },
            MooreEditOpDto::MoveState { id, x, y } => MooreEditOp::MoveState { id: StateId(id), x, y },
            MooreEditOpDto::RenameState { id, label } => MooreEditOp::RenameState { id: StateId(id), label },
            MooreEditOpDto::SetInitial { id } => MooreEditOp::SetInitial { id: id.map(StateId) },
            MooreEditOpDto::SetOutput { state, output } => MooreEditOp::SetOutput { state: StateId(state), output },
            MooreEditOpDto::SetTransitions { from, to, inputs } => {
                MooreEditOp::SetTransitions { from: StateId(from), to: StateId(to), inputs }
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MooreStateView {
    pub id: u32,
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub initial: bool,
    pub output: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MooreEdgeView {
    pub from: u32,
    pub to: u32,
    pub inputs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MooreDerived {
    pub input_alphabet: Vec<String>,
    pub output_alphabet: Vec<String>,
    pub deterministic: bool,
    pub unreachable: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MooreDocSnapshot {
    pub revision: u64,
    pub states: Vec<MooreStateView>,
    pub edges: Vec<MooreEdgeView>,
    pub derived: MooreDerived,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "patch")]
pub enum MooreDocPatch {
    StateAdded { id: u32, label: String, x: f64, y: f64 },
    StateRemoved { id: u32 },
    StateMoved { id: u32, x: f64, y: f64 },
    StateRenamed { id: u32, label: String },
    StateInitialSet { id: u32, initial: bool },
    StateOutputSet { id: u32, output: Option<String> },
    EdgeInputsSet { from: u32, to: u32, inputs: Vec<String> },
    EdgeRemoved { from: u32, to: u32 },
    AlphabetSet { input: Vec<String>, output: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MooreEditResult {
    pub revision: u64,
    pub patches: Vec<MooreDocPatch>,
    pub derived: MooreDerived,
}

pub fn snapshot_of(doc: &automata_core::moore_doc::MooreDocument) -> MooreDocSnapshot {
    MooreDocSnapshot {
        revision: doc.revision,
        states: state_views(&doc.model),
        edges: edge_views(&doc.model),
        derived: derived_of(&doc.model),
    }
}

fn state_views(model: &MooreDoc) -> Vec<MooreStateView> {
    let initial = model.initial_state();
    let mut views: Vec<MooreStateView> = model
        .states()
        .map(|id| {
            let meta = model.state_meta(id).expect("alive state has meta");
            MooreStateView {
                id: id.0,
                label: model.state_label(id).unwrap_or("").to_string(),
                x: meta.x,
                y: meta.y,
                initial: initial == Some(id),
                output: meta.output.and_then(|o| model.output_symbol_label(o)).map(str::to_string),
            }
        })
        .collect();
    views.sort_by_key(|s| s.id);
    views
}

fn edge_views(model: &MooreDoc) -> Vec<MooreEdgeView> {
    let mut views: Vec<MooreEdgeView> = model
        .edges()
        .map(|((from, to), inputs)| {
            let mut labels: Vec<String> =
                inputs.iter().filter_map(|input| model.input_symbol_label(*input)).map(str::to_string).collect();
            labels.sort();
            MooreEdgeView { from: from.0, to: to.0, inputs: labels }
        })
        .collect();
    views.sort_by_key(|e| (e.from, e.to));
    views
}

fn sorted_input_alphabet(model: &MooreDoc) -> Vec<String> {
    let mut alphabet: Vec<String> =
        model.input_alphabet().iter().filter_map(|s| model.input_symbol_label(*s).map(str::to_string)).collect();
    alphabet.sort();
    alphabet
}

fn sorted_output_alphabet(model: &MooreDoc) -> Vec<String> {
    let mut alphabet: Vec<String> = model
        .output_alphabet()
        .iter()
        .filter_map(|s| model.output_symbol_label(*s).map(str::to_string))
        .collect();
    alphabet.sort();
    alphabet
}

/// Same BFS-over-the-edit-facing-doc shape as `ipc::unreachable_states`/
/// `mealy_ipc::unreachable_states`.
fn unreachable_states(model: &MooreDoc) -> Vec<u32> {
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

pub(crate) fn derived_of(model: &MooreDoc) -> MooreDerived {
    MooreDerived {
        input_alphabet: sorted_input_alphabet(model),
        output_alphabet: sorted_output_alphabet(model),
        deterministic: model.is_deterministic(),
        unreachable: unreachable_states(model),
    }
}

#[derive(Clone, PartialEq)]
struct StateSnap {
    label: String,
    x: f64,
    y: f64,
    initial: bool,
    output: Option<String>,
}

fn snapshot_states(model: &MooreDoc) -> BTreeMap<u32, StateSnap> {
    let initial = model.initial_state();
    model
        .states()
        .map(|id| {
            let meta = model.state_meta(id).expect("alive state has meta");
            (
                id.0,
                StateSnap {
                    label: model.state_label(id).unwrap_or("").to_string(),
                    x: meta.x,
                    y: meta.y,
                    initial: initial == Some(id),
                    output: meta.output.and_then(|o| model.output_symbol_label(o)).map(str::to_string),
                },
            )
        })
        .collect()
}

#[derive(Clone, PartialEq)]
struct EdgeSnap {
    inputs: Vec<String>,
}

fn snapshot_edges(model: &MooreDoc) -> BTreeMap<(u32, u32), EdgeSnap> {
    model
        .edges()
        .map(|((from, to), inputs)| {
            let mut labels: Vec<String> =
                inputs.iter().filter_map(|input| model.input_symbol_label(*input)).map(str::to_string).collect();
            labels.sort();
            ((from.0, to.0), EdgeSnap { inputs: labels })
        })
        .collect()
}

/// The core IPC diff for Moore — same role as `ipc::diff_patches`/
/// `mealy_ipc::diff_patches`: the minimal `MooreDocPatch` sequence turning
/// `before` into `after`.
pub fn diff_patches(before: &MooreDoc, after: &MooreDoc) -> Vec<MooreDocPatch> {
    let mut patches = Vec::new();

    let before_states = snapshot_states(before);
    let after_states = snapshot_states(after);

    for (&id, a) in &after_states {
        match before_states.get(&id) {
            None => {
                patches.push(MooreDocPatch::StateAdded { id, label: a.label.clone(), x: a.x, y: a.y });
                if a.initial {
                    patches.push(MooreDocPatch::StateInitialSet { id, initial: true });
                }
                if a.output.is_some() {
                    patches.push(MooreDocPatch::StateOutputSet { id, output: a.output.clone() });
                }
            }
            Some(b) => {
                if b.label != a.label {
                    patches.push(MooreDocPatch::StateRenamed { id, label: a.label.clone() });
                }
                if b.x != a.x || b.y != a.y {
                    patches.push(MooreDocPatch::StateMoved { id, x: a.x, y: a.y });
                }
                if b.initial != a.initial {
                    patches.push(MooreDocPatch::StateInitialSet { id, initial: a.initial });
                }
                if b.output != a.output {
                    patches.push(MooreDocPatch::StateOutputSet { id, output: a.output.clone() });
                }
            }
        }
    }
    for &id in before_states.keys() {
        if !after_states.contains_key(&id) {
            patches.push(MooreDocPatch::StateRemoved { id });
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
            patches.push(MooreDocPatch::EdgeInputsSet { from, to, inputs: a.inputs.clone() });
        }
    }
    for &(from, to) in before_edges.keys() {
        if !after_edges.contains_key(&(from, to)) {
            patches.push(MooreDocPatch::EdgeRemoved { from, to });
        }
    }

    let before_input = sorted_input_alphabet(before);
    let after_input = sorted_input_alphabet(after);
    let before_output = sorted_output_alphabet(before);
    let after_output = sorted_output_alphabet(after);
    if before_input != after_input || before_output != after_output {
        patches.push(MooreDocPatch::AlphabetSet { input: after_input, output: after_output });
    }

    patches
}

/// A minimal patch-applying mirror proving the resync invariant
/// structurally — same role as `ipc::DocMirror`/`mealy_ipc::MealyDocMirror`
/// (see `tests/moore_resync_invariant.rs`).
#[derive(Debug, Clone, Default)]
pub struct MooreDocMirror {
    states: BTreeMap<u32, MooreStateView>,
    edges: BTreeMap<(u32, u32), MooreEdgeView>,
}

impl MooreDocMirror {
    pub fn from_snapshot(snapshot: &MooreDocSnapshot) -> Self {
        MooreDocMirror {
            states: snapshot.states.iter().map(|s| (s.id, s.clone())).collect(),
            edges: snapshot.edges.iter().map(|e| ((e.from, e.to), e.clone())).collect(),
        }
    }

    pub fn apply(&mut self, patches: &[MooreDocPatch]) {
        for patch in patches {
            match patch {
                MooreDocPatch::StateAdded { id, label, x, y } => {
                    self.states.insert(
                        *id,
                        MooreStateView { id: *id, label: label.clone(), x: *x, y: *y, initial: false, output: None },
                    );
                }
                MooreDocPatch::StateRemoved { id } => {
                    self.states.remove(id);
                }
                MooreDocPatch::StateMoved { id, x, y } => {
                    if let Some(s) = self.states.get_mut(id) {
                        s.x = *x;
                        s.y = *y;
                    }
                }
                MooreDocPatch::StateRenamed { id, label } => {
                    if let Some(s) = self.states.get_mut(id) {
                        s.label = label.clone();
                    }
                }
                MooreDocPatch::StateInitialSet { id, initial } => {
                    if let Some(s) = self.states.get_mut(id) {
                        s.initial = *initial;
                    }
                }
                MooreDocPatch::StateOutputSet { id, output } => {
                    if let Some(s) = self.states.get_mut(id) {
                        s.output = output.clone();
                    }
                }
                MooreDocPatch::EdgeInputsSet { from, to, inputs } => {
                    self.edges.insert((*from, *to), MooreEdgeView { from: *from, to: *to, inputs: inputs.clone() });
                }
                MooreDocPatch::EdgeRemoved { from, to } => {
                    self.edges.remove(&(*from, *to));
                }
                MooreDocPatch::AlphabetSet { .. } => {}
            }
        }
    }

    pub fn states_sorted(&self) -> Vec<MooreStateView> {
        self.states.values().cloned().collect()
    }

    pub fn edges_sorted(&self) -> Vec<MooreEdgeView> {
        self.edges.values().cloned().collect()
    }
}
