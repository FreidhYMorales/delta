//! IPC-facing DTOs and the patch/diff machinery that backs `doc_apply`
//! (design D3): every mutation returns `Vec<DocPatch>` (a diff), and a full
//! `DocSnapshot` is only sent on open/import or an explicit resync.
//!
//! These types intentionally never leak `automata_core` internals (e.g. raw
//! `StateId`/`SymbolId` newtypes) across the wire — everything here is a
//! plain, serde-friendly shape addressed by `u32` ids, per design D3 ("Step
//! payloads carry `Vec<StateId>` (u32), never names").

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use automata_core::doc::EditOp;
use automata_core::doc::Document;
use automata_core::ids::StateId;
use automata_core::model::fa::{Classification, FaDoc};

/// Wire-facing mirror of `automata_core::doc::EditOp`. `RestoreState` is
/// deliberately not exposed here: per its own doc comment it is
/// undo/redo-internal (the inverse of `RemoveState`), reconstructed by
/// `Document::undo`/`redo` themselves — never something a frontend should
/// construct directly via `doc_apply`. (Judgment call: the design's IPC
/// table lists `doc_apply(ops)` without enumerating op kinds; omitting the
/// inverse-only variant keeps the public edit surface exactly the set of
/// edits a user can actually originate.)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op")]
pub enum EditOpDto {
    AddState { label: String, x: f64, y: f64 },
    RemoveState { id: u32 },
    MoveState { id: u32, x: f64, y: f64 },
    RenameState { id: u32, label: String },
    SetInitial { id: Option<u32> },
    SetAccepting { id: u32, accepting: bool },
    SetEdge { from: u32, to: u32, epsilon: bool, symbols: Vec<String> },
}

impl EditOpDto {
    pub fn into_core(self) -> EditOp {
        match self {
            EditOpDto::AddState { label, x, y } => EditOp::AddState { label, x, y },
            EditOpDto::RemoveState { id } => EditOp::RemoveState { id: StateId(id) },
            EditOpDto::MoveState { id, x, y } => EditOp::MoveState { id: StateId(id), x, y },
            EditOpDto::RenameState { id, label } => EditOp::RenameState { id: StateId(id), label },
            EditOpDto::SetInitial { id } => EditOp::SetInitial { id: id.map(StateId) },
            EditOpDto::SetAccepting { id, accepting } => {
                EditOp::SetAccepting { id: StateId(id), accepting }
            }
            EditOpDto::SetEdge { from, to, epsilon, symbols } => EditOp::SetEdge {
                from: StateId(from),
                to: StateId(to),
                epsilon,
                symbols,
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StateView {
    pub id: u32,
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub initial: bool,
    pub accepting: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EdgeView {
    pub from: u32,
    pub to: u32,
    pub epsilon: bool,
    pub symbols: Vec<String>,
}

/// Facts about the document that are computed, not literally edited —
/// classification (DFA/NFA, spec "Determinism Is Derived"), the inferred
/// alphabet, and unreachable states (spec "Unreachable States Are Visible,
/// Never Hidden or Dropped"). (Judgment call: the design names `derived` on
/// `EditResult`/`DocSnapshot` without specifying its fields; this is the set
/// of cross-cutting spec facts that are naturally *derived* from the model
/// rather than literal patch data.)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Derived {
    pub classification: String, // "Dfa" | "Nfa"
    pub alphabet: Vec<String>,
    pub unreachable: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DocSnapshot {
    pub revision: u64,
    pub states: Vec<StateView>,
    pub edges: Vec<EdgeView>,
    pub derived: Derived,
}

/// One literal, minimal edit to the frontend's patch-applied mirror (design
/// D3). `StateRemoved` is not explicitly named in the design's prose list
/// (`StateAdded/Moved/Renamed/FlagsSet`) but is required for correctness:
/// `EditOp::RemoveState` already exists in `automata_core::doc` (PR2), and
/// without a removal patch a deleted state could never be reflected without
/// a full resync on every deletion — which would violate D3's "payload
/// growth" goal. Documented as a deviation in the apply-progress record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "patch")]
pub enum DocPatch {
    StateAdded { id: u32, label: String, x: f64, y: f64 },
    StateRemoved { id: u32 },
    StateMoved { id: u32, x: f64, y: f64 },
    StateRenamed { id: u32, label: String },
    StateFlagsSet { id: u32, initial: bool, accepting: bool },
    EdgeSymbolsSet { from: u32, to: u32, epsilon: bool, symbols: Vec<String> },
    EdgeRemoved { from: u32, to: u32 },
    AlphabetSet { symbols: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EditResult {
    pub revision: u64,
    pub patches: Vec<DocPatch>,
    pub derived: Derived,
}

pub fn snapshot_of(doc: &Document) -> DocSnapshot {
    DocSnapshot {
        revision: doc.revision,
        states: state_views(&doc.model),
        edges: edge_views(&doc.model),
        derived: derived_of(&doc.model),
    }
}

fn state_views(model: &FaDoc) -> Vec<StateView> {
    let initial = model.initial_state();
    let mut views: Vec<StateView> = model
        .states()
        .map(|id| {
            let meta = model.state_meta(id).expect("alive state has meta");
            StateView {
                id: id.0,
                label: model.state_label(id).unwrap_or("").to_string(),
                x: meta.x,
                y: meta.y,
                initial: initial == Some(id),
                accepting: meta.accepting,
            }
        })
        .collect();
    views.sort_by_key(|s| s.id);
    views
}

fn edge_views(model: &FaDoc) -> Vec<EdgeView> {
    let mut views: Vec<EdgeView> = model
        .edges()
        .map(|((from, to), set)| {
            let mut symbols: Vec<String> = set
                .symbols
                .iter()
                .filter_map(|s| model.symbol_label(*s).map(|l| l.to_string()))
                .collect();
            symbols.sort();
            EdgeView { from: from.0, to: to.0, epsilon: set.epsilon, symbols }
        })
        .collect();
    views.sort_by_key(|e| (e.from, e.to));
    views
}

fn sorted_alphabet(model: &FaDoc) -> Vec<String> {
    let mut alphabet: Vec<String> = model
        .alphabet()
        .iter()
        .filter_map(|s| model.symbol_label(*s).map(|l| l.to_string()))
        .collect();
    alphabet.sort();
    alphabet
}

/// States with no path from the initial state (spec "Unreachable States Are
/// Visible, Never Hidden or Dropped"). This is a plain BFS over the
/// edit-facing `FaDoc`'s edges — the IPC layer's own concern, distinct from
/// `engine::fa::FaEngine`'s compiled epsilon-closures used for simulation.
fn unreachable_states(model: &FaDoc) -> Vec<u32> {
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
        for ((from, to), _set) in model.edges() {
            if *from == cur && visited.insert(*to) {
                queue.push_back(*to);
            }
        }
    }

    let mut unreachable: Vec<u32> = all
        .iter()
        .filter(|id| !visited.contains(id))
        .map(|id| id.0)
        .collect();
    unreachable.sort();
    unreachable
}

pub(crate) fn derived_of(model: &FaDoc) -> Derived {
    let classification = match model.classify() {
        Classification::Dfa => "Dfa",
        Classification::Nfa => "Nfa",
    }
    .to_string();
    Derived {
        classification,
        alphabet: sorted_alphabet(model),
        unreachable: unreachable_states(model),
    }
}

#[derive(Clone)]
struct StateSnap {
    label: String,
    x: f64,
    y: f64,
    initial: bool,
    accepting: bool,
}

fn snapshot_states(model: &FaDoc) -> BTreeMap<u32, StateSnap> {
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
                    accepting: meta.accepting,
                },
            )
        })
        .collect()
}

#[derive(Clone, PartialEq)]
struct EdgeSnap {
    epsilon: bool,
    symbols: Vec<String>,
}

fn snapshot_edges(model: &FaDoc) -> BTreeMap<(u32, u32), EdgeSnap> {
    model
        .edges()
        .map(|((from, to), set)| {
            let mut symbols: Vec<String> = set
                .symbols
                .iter()
                .filter_map(|s| model.symbol_label(*s).map(|l| l.to_string()))
                .collect();
            symbols.sort();
            ((from.0, to.0), EdgeSnap { epsilon: set.epsilon, symbols })
        })
        .collect()
}

/// The core IPC diff: compute the minimal `DocPatch` sequence that turns
/// `before` into `after`. Every mutation command (`doc_apply`/`doc_undo`/
/// `doc_redo`) calls this around its `Document::apply`/`undo`/`redo` call —
/// by construction, replaying the result onto a mirror seeded from a
/// snapshot of `before` reproduces `after` exactly (task 6.8's resync
/// invariant).
pub fn diff_patches(before: &FaDoc, after: &FaDoc) -> Vec<DocPatch> {
    let mut patches = Vec::new();

    let before_states = snapshot_states(before);
    let after_states = snapshot_states(after);

    for (&id, a) in &after_states {
        match before_states.get(&id) {
            None => {
                patches.push(DocPatch::StateAdded {
                    id,
                    label: a.label.clone(),
                    x: a.x,
                    y: a.y,
                });
                if a.initial || a.accepting {
                    patches.push(DocPatch::StateFlagsSet {
                        id,
                        initial: a.initial,
                        accepting: a.accepting,
                    });
                }
            }
            Some(b) => {
                if b.label != a.label {
                    patches.push(DocPatch::StateRenamed { id, label: a.label.clone() });
                }
                if b.x != a.x || b.y != a.y {
                    patches.push(DocPatch::StateMoved { id, x: a.x, y: a.y });
                }
                if b.initial != a.initial || b.accepting != a.accepting {
                    patches.push(DocPatch::StateFlagsSet {
                        id,
                        initial: a.initial,
                        accepting: a.accepting,
                    });
                }
            }
        }
    }
    for &id in before_states.keys() {
        if !after_states.contains_key(&id) {
            patches.push(DocPatch::StateRemoved { id });
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
            patches.push(DocPatch::EdgeSymbolsSet {
                from,
                to,
                epsilon: a.epsilon,
                symbols: a.symbols.clone(),
            });
        }
    }
    for &(from, to) in before_edges.keys() {
        if !after_edges.contains_key(&(from, to)) {
            patches.push(DocPatch::EdgeRemoved { from, to });
        }
    }

    let before_alpha = sorted_alphabet(before);
    let after_alpha = sorted_alphabet(after);
    if before_alpha != after_alpha {
        patches.push(DocPatch::AlphabetSet { symbols: after_alpha });
    }

    patches
}

/// A minimal patch-applying mirror, mirroring what the frontend's `DocStore`
/// will do in PR5 (design D3/D6). Exists on the Rust side to prove the
/// resync invariant (task 6.8) structurally, independent of any frontend
/// implementation.
#[derive(Debug, Clone, Default)]
pub struct DocMirror {
    states: BTreeMap<u32, StateView>,
    edges: BTreeMap<(u32, u32), EdgeView>,
}

impl DocMirror {
    pub fn from_snapshot(snapshot: &DocSnapshot) -> Self {
        DocMirror {
            states: snapshot.states.iter().map(|s| (s.id, s.clone())).collect(),
            edges: snapshot.edges.iter().map(|e| ((e.from, e.to), e.clone())).collect(),
        }
    }

    pub fn apply(&mut self, patches: &[DocPatch]) {
        for patch in patches {
            match patch {
                DocPatch::StateAdded { id, label, x, y } => {
                    self.states.insert(
                        *id,
                        StateView {
                            id: *id,
                            label: label.clone(),
                            x: *x,
                            y: *y,
                            initial: false,
                            accepting: false,
                        },
                    );
                }
                DocPatch::StateRemoved { id } => {
                    self.states.remove(id);
                }
                DocPatch::StateMoved { id, x, y } => {
                    if let Some(s) = self.states.get_mut(id) {
                        s.x = *x;
                        s.y = *y;
                    }
                }
                DocPatch::StateRenamed { id, label } => {
                    if let Some(s) = self.states.get_mut(id) {
                        s.label = label.clone();
                    }
                }
                DocPatch::StateFlagsSet { id, initial, accepting } => {
                    if let Some(s) = self.states.get_mut(id) {
                        s.initial = *initial;
                        s.accepting = *accepting;
                    }
                }
                DocPatch::EdgeSymbolsSet { from, to, epsilon, symbols } => {
                    self.edges.insert(
                        (*from, *to),
                        EdgeView { from: *from, to: *to, epsilon: *epsilon, symbols: symbols.clone() },
                    );
                }
                DocPatch::EdgeRemoved { from, to } => {
                    self.edges.remove(&(*from, *to));
                }
                // Derived-only: no literal state/edge field carries alphabet
                // data (it is recomputed from edges), so there is nothing to
                // mirror here.
                DocPatch::AlphabetSet { .. } => {}
            }
        }
    }

    pub fn states_sorted(&self) -> Vec<StateView> {
        self.states.values().cloned().collect()
    }

    pub fn edges_sorted(&self) -> Vec<EdgeView> {
        self.edges.values().cloned().collect()
    }
}
