//! IPC-facing DTOs and patch/diff machinery for `TmDoc` — same shape and
//! rules as `pda_ipc.rs` (design D3: every mutation returns a diff, a full
//! snapshot only on open/import or resync), genuinely mirrored rather than
//! shared, for the same "isolate when shapes differ" reasoning `pda_ipc.rs`
//! itself documents.
//!
//! Differences from `pda_ipc.rs`, all traceable straight back to
//! `model::tm::TmDoc`'s own shape:
//!  - Transitions carry `tapes: Vec<TapeOpSpec>` (one read/write/direction
//!    triple per tape) instead of PDA's single `(input, pop, push)` triple —
//!    still individually addressable by `TransitionId`, same as PDA.
//!  - **One** shared tape alphabet (`TmDoc::alphabet()`) instead of PDA's
//!    two separate alphabets, so `TmDerived` carries a single `alphabet`
//!    field. It also carries `tape_count` — new information PDA's model
//!    never had (a PDA has no analogous "how many tapes" concept) — so the
//!    combined "derived facts changed" patch is named `DerivedSet` rather
//!    than reusing PDA's `AlphabetSet` name, since it now covers strictly
//!    more than just the alphabet.
//!  - Reuses `automata_core::dto::TmTapeOpDto` directly for the wire
//!    tape-op payload (`read`/`write`/`direction: String`, `"L"/"R"/"S"`)
//!    instead of defining a local mirror — its fields are already public
//!    and `Serialize + Deserialize + Clone + PartialEq`, and this is the
//!    same shape `TmEditOpDto`/`TmTransitionView` both need, so a second,
//!    field-identical local type would just be duplication with no
//!    layering benefit.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use automata_core::dto::TmTapeOpDto;
use automata_core::ids::StateId;
use automata_core::model::tm::{Direction, TmDoc, TransitionId};
use automata_core::tm_doc::{TapeOpSpec, TmEditOp};

/// `"L"/"R"/"S"` -> `Direction`, tolerating anything else as `Direction::Stay`
/// — `TmEditOp::apply`'s doc comment guarantees ops never panic on
/// structurally invalid input, so an unrecognized direction string degrades
/// to a harmless no-movement op rather than erroring.
fn parse_direction(s: &str) -> Direction {
    match s {
        "L" => Direction::Left,
        "R" => Direction::Right,
        _ => Direction::Stay,
    }
}

fn direction_str(d: Direction) -> &'static str {
    match d {
        Direction::Left => "L",
        Direction::Right => "R",
        Direction::Stay => "S",
    }
}

fn tapes_to_specs(tapes: Vec<TmTapeOpDto>) -> Vec<TapeOpSpec> {
    tapes.into_iter().map(|t| TapeOpSpec { read: t.read, write: t.write, direction: parse_direction(&t.direction) }).collect()
}

/// Wire-facing mirror of `TmEditOp` — same "no inverse-only variant exposed"
/// rule as `pda_ipc::PdaEditOpDto` (`RestoreState`/`RestoreTransition` stay
/// undo/redo internal).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op")]
pub enum TmEditOpDto {
    AddState { label: String, x: f64, y: f64 },
    RemoveState { id: u32 },
    MoveState { id: u32, x: f64, y: f64 },
    RenameState { id: u32, label: String },
    SetAccepting { id: u32, accepting: bool },
    SetInitial { id: Option<u32> },
    AddTransition { from: u32, to: u32, tapes: Vec<TmTapeOpDto> },
    RemoveTransition { id: u32 },
    EditTransition { id: u32, tapes: Vec<TmTapeOpDto> },
}

impl TmEditOpDto {
    pub fn into_core(self) -> TmEditOp {
        match self {
            TmEditOpDto::AddState { label, x, y } => TmEditOp::AddState { label, x, y },
            TmEditOpDto::RemoveState { id } => TmEditOp::RemoveState { id: StateId(id) },
            TmEditOpDto::MoveState { id, x, y } => TmEditOp::MoveState { id: StateId(id), x, y },
            TmEditOpDto::RenameState { id, label } => TmEditOp::RenameState { id: StateId(id), label },
            TmEditOpDto::SetAccepting { id, accepting } => TmEditOp::SetAccepting { id: StateId(id), accepting },
            TmEditOpDto::SetInitial { id } => TmEditOp::SetInitial { id: id.map(StateId) },
            TmEditOpDto::AddTransition { from, to, tapes } => {
                TmEditOp::AddTransition { from: StateId(from), to: StateId(to), tapes: tapes_to_specs(tapes) }
            }
            TmEditOpDto::RemoveTransition { id } => TmEditOp::RemoveTransition { id: TransitionId(id) },
            TmEditOpDto::EditTransition { id, tapes } => {
                TmEditOp::EditTransition { id: TransitionId(id), tapes: tapes_to_specs(tapes) }
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TmStateView {
    pub id: u32,
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub initial: bool,
    pub accepting: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TmTapeOpView {
    pub read: String,
    pub write: String,
    pub direction: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TmTransitionView {
    pub id: u32,
    pub from: u32,
    pub to: u32,
    pub tapes: Vec<TmTapeOpView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TmDerived {
    pub alphabet: Vec<String>,
    pub tape_count: usize,
    pub deterministic: bool,
    pub unreachable: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TmDocSnapshot {
    pub revision: u64,
    pub states: Vec<TmStateView>,
    pub transitions: Vec<TmTransitionView>,
    pub derived: TmDerived,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "patch")]
pub enum TmDocPatch {
    StateAdded { id: u32, label: String, x: f64, y: f64 },
    StateRemoved { id: u32 },
    StateMoved { id: u32, x: f64, y: f64 },
    StateRenamed { id: u32, label: String },
    StateInitialSet { id: u32, initial: bool },
    StateAcceptingSet { id: u32, accepting: bool },
    TransitionAdded { id: u32, from: u32, to: u32, tapes: Vec<TmTapeOpView> },
    TransitionRemoved { id: u32 },
    TransitionEdited { id: u32, tapes: Vec<TmTapeOpView> },
    /// Fired when the alphabet and/or `tape_count` changes — combined into
    /// one patch the same way PDA combines its two alphabets into one
    /// `AlphabetSet`, just under a name that covers `tape_count` too (see
    /// this module's doc comment).
    DerivedSet { alphabet: Vec<String>, tape_count: usize },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TmEditResult {
    pub revision: u64,
    pub patches: Vec<TmDocPatch>,
    pub derived: TmDerived,
}

pub fn snapshot_of(doc: &automata_core::tm_doc::TmDocument) -> TmDocSnapshot {
    TmDocSnapshot {
        revision: doc.revision,
        states: state_views(&doc.model),
        transitions: transition_views(&doc.model),
        derived: derived_of(&doc.model),
    }
}

fn state_views(model: &TmDoc) -> Vec<TmStateView> {
    let initial = model.initial_state();
    let mut views: Vec<TmStateView> = model
        .states()
        .map(|id| {
            let meta = model.state_meta(id).expect("alive state has meta");
            TmStateView {
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

fn tape_op_views(model: &TmDoc, tapes: &[automata_core::model::tm::TmTapeOp]) -> Vec<TmTapeOpView> {
    tapes
        .iter()
        .map(|op| TmTapeOpView {
            read: model.symbol_label(op.read).unwrap_or("").to_string(),
            write: model.symbol_label(op.write).unwrap_or("").to_string(),
            direction: direction_str(op.direction).to_string(),
        })
        .collect()
}

fn transition_view(model: &TmDoc, id: TransitionId, t: &automata_core::model::tm::TmTransition) -> TmTransitionView {
    TmTransitionView { id: id.0, from: t.from.0, to: t.to.0, tapes: tape_op_views(model, &t.tapes) }
}

fn transition_views(model: &TmDoc) -> Vec<TmTransitionView> {
    let mut views: Vec<TmTransitionView> =
        model.transitions().map(|(id, t)| transition_view(model, id, t)).collect();
    views.sort_by_key(|t| t.id);
    views
}

fn sorted_alphabet(model: &TmDoc) -> Vec<String> {
    let mut alphabet: Vec<String> =
        model.alphabet().iter().filter_map(|s| model.symbol_label(*s).map(str::to_string)).collect();
    alphabet.sort();
    alphabet
}

/// Same BFS-over-the-edit-facing-doc shape as `pda_ipc::unreachable_states`
/// — edit-time reachability only (ignores tape-read matchability, same as
/// `TmDoc::is_deterministic`'s own documented scope).
fn unreachable_states(model: &TmDoc) -> Vec<u32> {
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

pub(crate) fn derived_of(model: &TmDoc) -> TmDerived {
    TmDerived {
        alphabet: sorted_alphabet(model),
        tape_count: model.tape_count(),
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

fn snapshot_states(model: &TmDoc) -> BTreeMap<u32, StateSnap> {
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
    tapes: Vec<TmTapeOpView>,
}

fn snapshot_transitions(model: &TmDoc) -> BTreeMap<u32, TransitionSnap> {
    model
        .transitions()
        .map(|(id, t)| (id.0, TransitionSnap { from: t.from.0, to: t.to.0, tapes: tape_op_views(model, &t.tapes) }))
        .collect()
}

/// The core IPC diff for TM — same role as `pda_ipc::diff_patches`.
/// Transitions diff the same way PDA's do: `TransitionId` alone identifies a
/// transition across before/after, no composite key needed; `from`/`to` are
/// immutable once created so only `tapes` needs comparing for an edit.
pub fn diff_patches(before: &TmDoc, after: &TmDoc) -> Vec<TmDocPatch> {
    let mut patches = Vec::new();

    let before_states = snapshot_states(before);
    let after_states = snapshot_states(after);

    for (&id, a) in &after_states {
        match before_states.get(&id) {
            None => {
                patches.push(TmDocPatch::StateAdded { id, label: a.label.clone(), x: a.x, y: a.y });
                if a.initial {
                    patches.push(TmDocPatch::StateInitialSet { id, initial: true });
                }
                if a.accepting {
                    patches.push(TmDocPatch::StateAcceptingSet { id, accepting: true });
                }
            }
            Some(b) => {
                if b.label != a.label {
                    patches.push(TmDocPatch::StateRenamed { id, label: a.label.clone() });
                }
                if b.x != a.x || b.y != a.y {
                    patches.push(TmDocPatch::StateMoved { id, x: a.x, y: a.y });
                }
                if b.initial != a.initial {
                    patches.push(TmDocPatch::StateInitialSet { id, initial: a.initial });
                }
                if b.accepting != a.accepting {
                    patches.push(TmDocPatch::StateAcceptingSet { id, accepting: a.accepting });
                }
            }
        }
    }
    for &id in before_states.keys() {
        if !after_states.contains_key(&id) {
            patches.push(TmDocPatch::StateRemoved { id });
        }
    }

    let before_transitions = snapshot_transitions(before);
    let after_transitions = snapshot_transitions(after);

    for (&id, a) in &after_transitions {
        match before_transitions.get(&id) {
            None => patches.push(TmDocPatch::TransitionAdded { id, from: a.from, to: a.to, tapes: a.tapes.clone() }),
            Some(b) => {
                if b.tapes != a.tapes {
                    patches.push(TmDocPatch::TransitionEdited { id, tapes: a.tapes.clone() });
                }
                // `from`/`to` are immutable once created (a moved endpoint
                // is a remove+add, not an edit — see `TmEditOp::EditTransition`'s
                // doc comment), so no `from`/`to` diffing is needed here.
            }
        }
    }
    for &id in before_transitions.keys() {
        if !after_transitions.contains_key(&id) {
            patches.push(TmDocPatch::TransitionRemoved { id });
        }
    }

    let before_alphabet = sorted_alphabet(before);
    let after_alphabet = sorted_alphabet(after);
    let before_tape_count = before.tape_count();
    let after_tape_count = after.tape_count();
    if before_alphabet != after_alphabet || before_tape_count != after_tape_count {
        patches.push(TmDocPatch::DerivedSet { alphabet: after_alphabet, tape_count: after_tape_count });
    }

    patches
}

/// A minimal patch-applying mirror proving the resync invariant
/// structurally — same role as `pda_ipc::PdaDocMirror` (see
/// `tests/tm_resync_invariant.rs`).
#[derive(Debug, Clone, Default)]
pub struct TmDocMirror {
    states: BTreeMap<u32, TmStateView>,
    transitions: BTreeMap<u32, TmTransitionView>,
}

impl TmDocMirror {
    pub fn from_snapshot(snapshot: &TmDocSnapshot) -> Self {
        TmDocMirror {
            states: snapshot.states.iter().map(|s| (s.id, s.clone())).collect(),
            transitions: snapshot.transitions.iter().map(|t| (t.id, t.clone())).collect(),
        }
    }

    pub fn apply(&mut self, patches: &[TmDocPatch]) {
        for patch in patches {
            match patch {
                TmDocPatch::StateAdded { id, label, x, y } => {
                    self.states.insert(
                        *id,
                        TmStateView { id: *id, label: label.clone(), x: *x, y: *y, initial: false, accepting: false },
                    );
                }
                TmDocPatch::StateRemoved { id } => {
                    self.states.remove(id);
                }
                TmDocPatch::StateMoved { id, x, y } => {
                    if let Some(s) = self.states.get_mut(id) {
                        s.x = *x;
                        s.y = *y;
                    }
                }
                TmDocPatch::StateRenamed { id, label } => {
                    if let Some(s) = self.states.get_mut(id) {
                        s.label = label.clone();
                    }
                }
                TmDocPatch::StateInitialSet { id, initial } => {
                    if let Some(s) = self.states.get_mut(id) {
                        s.initial = *initial;
                    }
                }
                TmDocPatch::StateAcceptingSet { id, accepting } => {
                    if let Some(s) = self.states.get_mut(id) {
                        s.accepting = *accepting;
                    }
                }
                TmDocPatch::TransitionAdded { id, from, to, tapes } => {
                    self.transitions.insert(
                        *id,
                        TmTransitionView { id: *id, from: *from, to: *to, tapes: tapes.clone() },
                    );
                }
                TmDocPatch::TransitionRemoved { id } => {
                    self.transitions.remove(id);
                }
                TmDocPatch::TransitionEdited { id, tapes } => {
                    if let Some(t) = self.transitions.get_mut(id) {
                        t.tapes = tapes.clone();
                    }
                }
                TmDocPatch::DerivedSet { .. } => {}
            }
        }
    }

    pub fn states_sorted(&self) -> Vec<TmStateView> {
        self.states.values().cloned().collect()
    }

    pub fn transitions_sorted(&self) -> Vec<TmTransitionView> {
        self.transitions.values().cloned().collect()
    }
}
