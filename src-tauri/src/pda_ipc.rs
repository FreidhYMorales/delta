//! IPC-facing DTOs and patch/diff machinery for `PdaDoc` — same shape and
//! rules as `moore_ipc.rs` (design D3: every mutation returns a diff, a full
//! snapshot only on open/import or resync), genuinely mirrored rather than
//! shared, for the same reason `PdaDoc` is its own type instead of an
//! `FaDoc`/`MealyDoc`/`MooreDoc` extension (docs/decisions.md).
//!
//! Differences from `moore_ipc.rs`, all traceable straight back to
//! `model::pda::PdaDoc`'s own shape:
//!  - `PdaStateView.accepting: bool` instead of Moore's `output` — a PDA has
//!    accepting states, Moore doesn't.
//!  - Transitions are **individually addressable** (`TransitionId`, a plain
//!    counter), not one payload per `(from, to)` edge like Moore's
//!    `EdgeInputsSet` — several transitions can share the same endpoints
//!    with different `(input, pop, push)` triples. So instead of one
//!    "replace this edge's whole payload" patch, there are
//!    `TransitionAdded`/`TransitionRemoved`/`TransitionEdited` patches, each
//!    keyed by a stable `TransitionId` that never collides or gets reused
//!    (`model::pda`'s doc comment) — this actually makes the transition side
//!    of `diff_patches` *simpler* than Moore's edge-pair diffing: a
//!    transition's id alone identifies it across before/after snapshots, no
//!    `(from, to)` composite key needed.
//!  - Two alphabets (`input_alphabet`, `stack_alphabet`) instead of Moore's
//!    one input/output pair.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use automata_core::ids::StateId;
use automata_core::model::pda::{PdaDoc, TransitionId};
use automata_core::pda_doc::PdaEditOp;

/// Wire-facing mirror of `PdaEditOp` — same "no inverse-only variant
/// exposed" rule as `moore_ipc::MooreEditOpDto` (`RestoreState`/
/// `RestoreTransition` stay undo/redo internal).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op")]
pub enum PdaEditOpDto {
    AddState { label: String, x: f64, y: f64 },
    RemoveState { id: u32 },
    MoveState { id: u32, x: f64, y: f64 },
    RenameState { id: u32, label: String },
    SetAccepting { id: u32, accepting: bool },
    SetInitial { id: Option<u32> },
    AddTransition { from: u32, to: u32, input: Option<String>, pop: Vec<String>, push: Vec<String> },
    RemoveTransition { id: u32 },
    EditTransition { id: u32, input: Option<String>, pop: Vec<String>, push: Vec<String> },
}

impl PdaEditOpDto {
    pub fn into_core(self) -> PdaEditOp {
        match self {
            PdaEditOpDto::AddState { label, x, y } => PdaEditOp::AddState { label, x, y },
            PdaEditOpDto::RemoveState { id } => PdaEditOp::RemoveState { id: StateId(id) },
            PdaEditOpDto::MoveState { id, x, y } => PdaEditOp::MoveState { id: StateId(id), x, y },
            PdaEditOpDto::RenameState { id, label } => PdaEditOp::RenameState { id: StateId(id), label },
            PdaEditOpDto::SetAccepting { id, accepting } => PdaEditOp::SetAccepting { id: StateId(id), accepting },
            PdaEditOpDto::SetInitial { id } => PdaEditOp::SetInitial { id: id.map(StateId) },
            PdaEditOpDto::AddTransition { from, to, input, pop, push } => {
                PdaEditOp::AddTransition { from: StateId(from), to: StateId(to), input, pop, push }
            }
            PdaEditOpDto::RemoveTransition { id } => PdaEditOp::RemoveTransition { id: TransitionId(id) },
            PdaEditOpDto::EditTransition { id, input, pop, push } => {
                PdaEditOp::EditTransition { id: TransitionId(id), input, pop, push }
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PdaStateView {
    pub id: u32,
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub initial: bool,
    pub accepting: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PdaTransitionView {
    pub id: u32,
    pub from: u32,
    pub to: u32,
    pub input: Option<String>,
    pub pop: Vec<String>,
    pub push: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PdaDerived {
    pub input_alphabet: Vec<String>,
    pub stack_alphabet: Vec<String>,
    pub deterministic: bool,
    pub unreachable: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PdaDocSnapshot {
    pub revision: u64,
    pub states: Vec<PdaStateView>,
    pub transitions: Vec<PdaTransitionView>,
    pub derived: PdaDerived,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "patch")]
pub enum PdaDocPatch {
    StateAdded { id: u32, label: String, x: f64, y: f64 },
    StateRemoved { id: u32 },
    StateMoved { id: u32, x: f64, y: f64 },
    StateRenamed { id: u32, label: String },
    StateInitialSet { id: u32, initial: bool },
    StateAcceptingSet { id: u32, accepting: bool },
    TransitionAdded { id: u32, from: u32, to: u32, input: Option<String>, pop: Vec<String>, push: Vec<String> },
    TransitionRemoved { id: u32 },
    TransitionEdited { id: u32, input: Option<String>, pop: Vec<String>, push: Vec<String> },
    AlphabetSet { input: Vec<String>, stack: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PdaEditResult {
    pub revision: u64,
    pub patches: Vec<PdaDocPatch>,
    pub derived: PdaDerived,
}

pub fn snapshot_of(doc: &automata_core::pda_doc::PdaDocument) -> PdaDocSnapshot {
    PdaDocSnapshot {
        revision: doc.revision,
        states: state_views(&doc.model),
        transitions: transition_views(&doc.model),
        derived: derived_of(&doc.model),
    }
}

fn state_views(model: &PdaDoc) -> Vec<PdaStateView> {
    let initial = model.initial_state();
    let mut views: Vec<PdaStateView> = model
        .states()
        .map(|id| {
            let meta = model.state_meta(id).expect("alive state has meta");
            PdaStateView {
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

fn transition_view(model: &PdaDoc, id: TransitionId, t: &automata_core::model::pda::PdaTransition) -> PdaTransitionView {
    PdaTransitionView {
        id: id.0,
        from: t.from.0,
        to: t.to.0,
        input: t.input.and_then(|s| model.input_symbol_label(s)).map(str::to_string),
        pop: t.pop.iter().filter_map(|s| model.stack_symbol_label(*s)).map(str::to_string).collect(),
        push: t.push.iter().filter_map(|s| model.stack_symbol_label(*s)).map(str::to_string).collect(),
    }
}

fn transition_views(model: &PdaDoc) -> Vec<PdaTransitionView> {
    let mut views: Vec<PdaTransitionView> =
        model.transitions().map(|(id, t)| transition_view(model, id, t)).collect();
    views.sort_by_key(|t| t.id);
    views
}

fn sorted_input_alphabet(model: &PdaDoc) -> Vec<String> {
    let mut alphabet: Vec<String> =
        model.input_alphabet().iter().filter_map(|s| model.input_symbol_label(*s).map(str::to_string)).collect();
    alphabet.sort();
    alphabet
}

fn sorted_stack_alphabet(model: &PdaDoc) -> Vec<String> {
    let mut alphabet: Vec<String> =
        model.stack_alphabet().iter().filter_map(|s| model.stack_symbol_label(*s).map(str::to_string)).collect();
    alphabet.sort();
    alphabet
}

/// Same BFS-over-the-edit-facing-doc shape as `moore_ipc::unreachable_states`
/// — edit-time reachability only (ignores `input`/`pop` matchability, same
/// as `PdaDoc::is_deterministic`'s own documented scope).
fn unreachable_states(model: &PdaDoc) -> Vec<u32> {
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
        for (_, t) in model.transitions() {
            if t.from == cur && visited.insert(t.to) {
                queue.push_back(t.to);
            }
        }
    }

    let mut unreachable: Vec<u32> = all.iter().filter(|id| !visited.contains(id)).map(|id| id.0).collect();
    unreachable.sort();
    unreachable
}

pub(crate) fn derived_of(model: &PdaDoc) -> PdaDerived {
    PdaDerived {
        input_alphabet: sorted_input_alphabet(model),
        stack_alphabet: sorted_stack_alphabet(model),
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
    accepting: bool,
}

fn snapshot_states(model: &PdaDoc) -> BTreeMap<u32, StateSnap> {
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
struct TransitionSnap {
    from: u32,
    to: u32,
    input: Option<String>,
    pop: Vec<String>,
    push: Vec<String>,
}

fn snapshot_transitions(model: &PdaDoc) -> BTreeMap<u32, TransitionSnap> {
    model
        .transitions()
        .map(|(id, t)| {
            (
                id.0,
                TransitionSnap {
                    from: t.from.0,
                    to: t.to.0,
                    input: t.input.and_then(|s| model.input_symbol_label(s)).map(str::to_string),
                    pop: t.pop.iter().filter_map(|s| model.stack_symbol_label(*s)).map(str::to_string).collect(),
                    push: t.push.iter().filter_map(|s| model.stack_symbol_label(*s)).map(str::to_string).collect(),
                },
            )
        })
        .collect()
}

/// The core IPC diff for PDA — same role as `moore_ipc::diff_patches`.
/// Transitions diff more simply than Moore's edges: `TransitionId` alone
/// identifies a transition across before/after, no composite key needed.
pub fn diff_patches(before: &PdaDoc, after: &PdaDoc) -> Vec<PdaDocPatch> {
    let mut patches = Vec::new();

    let before_states = snapshot_states(before);
    let after_states = snapshot_states(after);

    for (&id, a) in &after_states {
        match before_states.get(&id) {
            None => {
                patches.push(PdaDocPatch::StateAdded { id, label: a.label.clone(), x: a.x, y: a.y });
                if a.initial {
                    patches.push(PdaDocPatch::StateInitialSet { id, initial: true });
                }
                if a.accepting {
                    patches.push(PdaDocPatch::StateAcceptingSet { id, accepting: true });
                }
            }
            Some(b) => {
                if b.label != a.label {
                    patches.push(PdaDocPatch::StateRenamed { id, label: a.label.clone() });
                }
                if b.x != a.x || b.y != a.y {
                    patches.push(PdaDocPatch::StateMoved { id, x: a.x, y: a.y });
                }
                if b.initial != a.initial {
                    patches.push(PdaDocPatch::StateInitialSet { id, initial: a.initial });
                }
                if b.accepting != a.accepting {
                    patches.push(PdaDocPatch::StateAcceptingSet { id, accepting: a.accepting });
                }
            }
        }
    }
    for &id in before_states.keys() {
        if !after_states.contains_key(&id) {
            patches.push(PdaDocPatch::StateRemoved { id });
        }
    }

    let before_transitions = snapshot_transitions(before);
    let after_transitions = snapshot_transitions(after);

    for (&id, a) in &after_transitions {
        match before_transitions.get(&id) {
            None => patches.push(PdaDocPatch::TransitionAdded {
                id,
                from: a.from,
                to: a.to,
                input: a.input.clone(),
                pop: a.pop.clone(),
                push: a.push.clone(),
            }),
            Some(b) => {
                if b.input != a.input || b.pop != a.pop || b.push != a.push {
                    patches.push(PdaDocPatch::TransitionEdited {
                        id,
                        input: a.input.clone(),
                        pop: a.pop.clone(),
                        push: a.push.clone(),
                    });
                }
                // `from`/`to` are immutable once created (a moved endpoint
                // is a remove+add, not an edit — see `PdaEditOp::EditTransition`'s
                // doc comment), so no `from`/`to` diffing is needed here.
            }
        }
    }
    for &id in before_transitions.keys() {
        if !after_transitions.contains_key(&id) {
            patches.push(PdaDocPatch::TransitionRemoved { id });
        }
    }

    let before_input = sorted_input_alphabet(before);
    let after_input = sorted_input_alphabet(after);
    let before_stack = sorted_stack_alphabet(before);
    let after_stack = sorted_stack_alphabet(after);
    if before_input != after_input || before_stack != after_stack {
        patches.push(PdaDocPatch::AlphabetSet { input: after_input, stack: after_stack });
    }

    patches
}

/// A minimal patch-applying mirror proving the resync invariant
/// structurally — same role as `moore_ipc::MooreDocMirror` (see
/// `tests/pda_resync_invariant.rs`).
#[derive(Debug, Clone, Default)]
pub struct PdaDocMirror {
    states: BTreeMap<u32, PdaStateView>,
    transitions: BTreeMap<u32, PdaTransitionView>,
}

impl PdaDocMirror {
    pub fn from_snapshot(snapshot: &PdaDocSnapshot) -> Self {
        PdaDocMirror {
            states: snapshot.states.iter().map(|s| (s.id, s.clone())).collect(),
            transitions: snapshot.transitions.iter().map(|t| (t.id, t.clone())).collect(),
        }
    }

    pub fn apply(&mut self, patches: &[PdaDocPatch]) {
        for patch in patches {
            match patch {
                PdaDocPatch::StateAdded { id, label, x, y } => {
                    self.states.insert(
                        *id,
                        PdaStateView { id: *id, label: label.clone(), x: *x, y: *y, initial: false, accepting: false },
                    );
                }
                PdaDocPatch::StateRemoved { id } => {
                    self.states.remove(id);
                }
                PdaDocPatch::StateMoved { id, x, y } => {
                    if let Some(s) = self.states.get_mut(id) {
                        s.x = *x;
                        s.y = *y;
                    }
                }
                PdaDocPatch::StateRenamed { id, label } => {
                    if let Some(s) = self.states.get_mut(id) {
                        s.label = label.clone();
                    }
                }
                PdaDocPatch::StateInitialSet { id, initial } => {
                    if let Some(s) = self.states.get_mut(id) {
                        s.initial = *initial;
                    }
                }
                PdaDocPatch::StateAcceptingSet { id, accepting } => {
                    if let Some(s) = self.states.get_mut(id) {
                        s.accepting = *accepting;
                    }
                }
                PdaDocPatch::TransitionAdded { id, from, to, input, pop, push } => {
                    self.transitions.insert(
                        *id,
                        PdaTransitionView {
                            id: *id,
                            from: *from,
                            to: *to,
                            input: input.clone(),
                            pop: pop.clone(),
                            push: push.clone(),
                        },
                    );
                }
                PdaDocPatch::TransitionRemoved { id } => {
                    self.transitions.remove(id);
                }
                PdaDocPatch::TransitionEdited { id, input, pop, push } => {
                    if let Some(t) = self.transitions.get_mut(id) {
                        t.input = input.clone();
                        t.pop = pop.clone();
                        t.push = push.clone();
                    }
                }
                PdaDocPatch::AlphabetSet { .. } => {}
            }
        }
    }

    pub fn states_sorted(&self) -> Vec<PdaStateView> {
        self.states.values().cloned().collect()
    }

    pub fn transitions_sorted(&self) -> Vec<PdaTransitionView> {
        self.transitions.values().cloned().collect()
    }
}
