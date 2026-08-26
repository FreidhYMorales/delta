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
use crate::model::mealy::MealyDoc;
use crate::model::moore::MooreDoc;
use crate::model::pda::PdaDoc;
use crate::model::tm::TmDoc;

pub const CURRENT_VERSION: u32 = 1;

/// The `kind`-tagged boundary enum design D1 anticipated growing (see this
/// module's own doc comment: "v1 ships only `Fa`; unknown future kinds ...
/// fail with a message, never panic") — `Mealy` is the first addition to
/// it. `load_from_str`/`save_to_string` stay FA-only on purpose (option B
/// of the Mealy decision, docs/decisions.md: isolate, don't touch the
/// already-tested FA persistence path) — `mealy_load_from_str`/
/// `mealy_save_to_string` below are Mealy's own equivalents, sharing this
/// same envelope shape rather than inventing a second wire format. `Moore`
/// follows the exact same pattern (`moore_save_to_string`/
/// `moore_load_from_str`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum MachineDoc {
    Fa(FaDto),
    Mealy(MealyDto),
    Moore(MooreDto),
    Pda(PdaDto),
    Tm(TmDto),
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MealyDto {
    pub states: Vec<MealyStateDto>,
    pub edges: Vec<MealyEdgeDto>,
    pub initial: Option<usize>,
}

/// No `accepting` field — see `model::mealy`'s doc comment for why.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MealyStateDto {
    pub label: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MealyEdgeDto {
    pub from: usize,
    pub to: usize,
    /// `(input, output)` pairs — a Mealy edge is a small map, not a flat
    /// symbol set (see `model::mealy`'s doc comment on why `SymbolSet`
    /// doesn't fit here).
    pub transitions: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MooreDto {
    pub states: Vec<MooreStateDto>,
    pub edges: Vec<MooreEdgeDto>,
    pub initial: Option<usize>,
}

/// No `accepting` field, same reasoning as `MealyStateDto`. `output` lives
/// here (on the state), not on `MooreEdgeDto` — see `model::moore`'s doc
/// comment.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MooreStateDto {
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MooreEdgeDto {
    pub from: usize,
    pub to: usize,
    /// Input symbols only — no per-symbol output (unlike `MealyEdgeDto`).
    pub inputs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PdaDto {
    pub states: Vec<PdaStateDto>,
    /// A flat list, **not** grouped by `(from, to)` like `FaDto`/
    /// `MealyDto`/`MooreDto`'s edges — a PDA transition is individually
    /// addressable (`model::pda`'s doc comment), so several can share the
    /// same endpoints with different `(input, pop, push)` triples.
    pub transitions: Vec<PdaTransitionDto>,
    pub initial: Option<usize>,
}

/// Has `accepting`, unlike `MealyStateDto`/`MooreStateDto` — a PDA
/// genuinely has accepting states (see `model::pda`'s doc comment).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PdaStateDto {
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub accepting: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PdaTransitionDto {
    pub from: usize,
    pub to: usize,
    /// `None` = epsilon.
    pub input: Option<String>,
    /// Top-to-bottom order — see `model::pda`'s doc comment.
    pub pop: Vec<String>,
    /// Top-to-bottom order — see `model::pda`'s doc comment.
    pub push: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TmDto {
    pub states: Vec<TmStateDto>,
    /// A flat list, same "individually addressable" reasoning as
    /// `PdaDto::transitions` — see `model::tm`'s doc comment.
    pub transitions: Vec<TmTransitionDto>,
    pub initial: Option<usize>,
    /// `0` if no transition has been added yet — see `model::tm`'s doc
    /// comment on `TmDoc::tape_count`.
    pub tape_count: usize,
}

/// Has `accepting`, same as `PdaStateDto` — a TM genuinely has accepting
/// states (see `model::tm`'s doc comment).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TmStateDto {
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub accepting: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TmTransitionDto {
    pub from: usize,
    pub to: usize,
    pub tapes: Vec<TmTapeOpDto>,
}

/// `direction` is `"L"`/`"R"`/`"S"` — matches JFLAP's own direction-string
/// convention exactly, so a saved file's raw text is recognizable.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TmTapeOpDto {
    pub read: String,
    pub write: String,
    pub direction: String,
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
    #[error("expected a {expected} document, found a {found} one")]
    WrongKind { expected: &'static str, found: &'static str },
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
        MachineDoc::Mealy(_) => Err(DtoError::WrongKind { expected: "Fa", found: "Mealy" }),
        MachineDoc::Moore(_) => Err(DtoError::WrongKind { expected: "Fa", found: "Moore" }),
        MachineDoc::Pda(_) => Err(DtoError::WrongKind { expected: "Fa", found: "Pda" }),
        MachineDoc::Tm(_) => Err(DtoError::WrongKind { expected: "Fa", found: "Tm" }),
    }
}

/// Project a `MealyDoc` into its serializable DTO — same "positional index,
/// sorted for reproducibility" rules as `fa_to_dto`.
pub fn mealy_to_dto(doc: &MealyDoc) -> MealyDto {
    let alive: Vec<StateId> = doc.states().collect();
    let index_of: HashMap<StateId, usize> = alive.iter().enumerate().map(|(i, &id)| (id, i)).collect();

    let states = alive
        .iter()
        .map(|&id| {
            let meta = doc.state_meta(id).expect("alive state has meta");
            MealyStateDto { label: doc.state_label(id).expect("alive state has label").to_string(), x: meta.x, y: meta.y }
        })
        .collect();

    let mut edges: Vec<MealyEdgeDto> = doc
        .edges()
        .map(|((from, to), transitions)| {
            let mut pairs: Vec<(String, String)> = transitions
                .iter()
                .map(|(input, output)| {
                    (
                        doc.input_symbol_label(*input).expect("interned input has a label").to_string(),
                        doc.output_symbol_label(*output).expect("interned output has a label").to_string(),
                    )
                })
                .collect();
            pairs.sort();
            MealyEdgeDto { from: index_of[from], to: index_of[to], transitions: pairs }
        })
        .collect();
    edges.sort_by_key(|e| (e.from, e.to));

    let initial = doc.initial_state().map(|id| index_of[&id]);

    MealyDto { states, edges, initial }
}

/// Reconstruct a `MealyDoc` from its DTO, allocating fresh `StateId`s in
/// `states` array order.
pub fn mealy_from_dto(dto: &MealyDto) -> Result<MealyDoc, DtoError> {
    let mut doc = MealyDoc::new();
    let mut ids = Vec::with_capacity(dto.states.len());
    for s in &dto.states {
        let id = doc.add_state(&s.label, s.x, s.y).map_err(|_| DtoError::InvalidStateIndex(ids.len()))?;
        ids.push(id);
    }
    for e in &dto.edges {
        let from = *ids.get(e.from).ok_or(DtoError::InvalidStateIndex(e.from))?;
        let to = *ids.get(e.to).ok_or(DtoError::InvalidStateIndex(e.to))?;
        for (input, output) in &e.transitions {
            doc.add_transition(from, to, input, output);
        }
    }
    if let Some(idx) = dto.initial {
        let id = *ids.get(idx).ok_or(DtoError::InvalidStateIndex(idx))?;
        doc.set_initial(Some(id));
    }
    Ok(doc)
}

pub fn mealy_save_to_string(doc: &MealyDoc) -> Result<String, DtoError> {
    let envelope = Envelope { version: CURRENT_VERSION, document: MachineDoc::Mealy(mealy_to_dto(doc)) };
    Ok(serde_json::to_string_pretty(&envelope)?)
}

pub fn mealy_load_from_str(s: &str) -> Result<MealyDoc, DtoError> {
    let envelope: Envelope = serde_json::from_str(s)?;
    if envelope.version != CURRENT_VERSION {
        return Err(DtoError::UnsupportedVersion(envelope.version));
    }
    match envelope.document {
        MachineDoc::Mealy(dto) => mealy_from_dto(&dto),
        MachineDoc::Fa(_) => Err(DtoError::WrongKind { expected: "Mealy", found: "Fa" }),
        MachineDoc::Moore(_) => Err(DtoError::WrongKind { expected: "Mealy", found: "Moore" }),
        MachineDoc::Pda(_) => Err(DtoError::WrongKind { expected: "Mealy", found: "Pda" }),
        MachineDoc::Tm(_) => Err(DtoError::WrongKind { expected: "Mealy", found: "Tm" }),
    }
}

/// Project a `MooreDoc` into its serializable DTO — same "positional index,
/// sorted for reproducibility" rules as `fa_to_dto`/`mealy_to_dto`.
pub fn moore_to_dto(doc: &MooreDoc) -> MooreDto {
    let alive: Vec<StateId> = doc.states().collect();
    let index_of: HashMap<StateId, usize> = alive.iter().enumerate().map(|(i, &id)| (id, i)).collect();

    let states = alive
        .iter()
        .map(|&id| {
            let meta = doc.state_meta(id).expect("alive state has meta");
            let output = meta.output.map(|o| doc.output_symbol_label(o).expect("interned output has a label").to_string());
            MooreStateDto { label: doc.state_label(id).expect("alive state has label").to_string(), x: meta.x, y: meta.y, output }
        })
        .collect();

    let mut edges: Vec<MooreEdgeDto> = doc
        .edges()
        .map(|((from, to), inputs)| {
            let mut labels: Vec<String> =
                inputs.iter().map(|input| doc.input_symbol_label(*input).expect("interned input has a label").to_string()).collect();
            labels.sort();
            MooreEdgeDto { from: index_of[from], to: index_of[to], inputs: labels }
        })
        .collect();
    edges.sort_by_key(|e| (e.from, e.to));

    let initial = doc.initial_state().map(|id| index_of[&id]);

    MooreDto { states, edges, initial }
}

/// Reconstruct a `MooreDoc` from its DTO, allocating fresh `StateId`s in
/// `states` array order.
pub fn moore_from_dto(dto: &MooreDto) -> Result<MooreDoc, DtoError> {
    let mut doc = MooreDoc::new();
    let mut ids = Vec::with_capacity(dto.states.len());
    for s in &dto.states {
        let id = doc.add_state(&s.label, s.x, s.y).map_err(|_| DtoError::InvalidStateIndex(ids.len()))?;
        if let Some(output) = &s.output {
            let output_id = doc.intern_output_symbol(output);
            doc.set_output(id, Some(output_id));
        }
        ids.push(id);
    }
    for e in &dto.edges {
        let from = *ids.get(e.from).ok_or(DtoError::InvalidStateIndex(e.from))?;
        let to = *ids.get(e.to).ok_or(DtoError::InvalidStateIndex(e.to))?;
        for input in &e.inputs {
            doc.add_transition(from, to, input);
        }
    }
    if let Some(idx) = dto.initial {
        let id = *ids.get(idx).ok_or(DtoError::InvalidStateIndex(idx))?;
        doc.set_initial(Some(id));
    }
    Ok(doc)
}

pub fn moore_save_to_string(doc: &MooreDoc) -> Result<String, DtoError> {
    let envelope = Envelope { version: CURRENT_VERSION, document: MachineDoc::Moore(moore_to_dto(doc)) };
    Ok(serde_json::to_string_pretty(&envelope)?)
}

pub fn moore_load_from_str(s: &str) -> Result<MooreDoc, DtoError> {
    let envelope: Envelope = serde_json::from_str(s)?;
    if envelope.version != CURRENT_VERSION {
        return Err(DtoError::UnsupportedVersion(envelope.version));
    }
    match envelope.document {
        MachineDoc::Moore(dto) => moore_from_dto(&dto),
        MachineDoc::Fa(_) => Err(DtoError::WrongKind { expected: "Moore", found: "Fa" }),
        MachineDoc::Mealy(_) => Err(DtoError::WrongKind { expected: "Moore", found: "Mealy" }),
        MachineDoc::Pda(_) => Err(DtoError::WrongKind { expected: "Moore", found: "Pda" }),
        MachineDoc::Tm(_) => Err(DtoError::WrongKind { expected: "Moore", found: "Tm" }),
    }
}

/// Project a `PdaDoc` into its serializable DTO — same "positional index,
/// sorted for reproducibility" rules as `fa_to_dto`/`mealy_to_dto`/
/// `moore_to_dto`, except transitions are a flat list (each individually
/// addressable, see `model::pda`'s doc comment) sorted by
/// `(from, to, input, pop, push)` rather than grouped by endpoint.
pub fn pda_to_dto(doc: &PdaDoc) -> PdaDto {
    let alive: Vec<StateId> = doc.states().collect();
    let index_of: HashMap<StateId, usize> = alive.iter().enumerate().map(|(i, &id)| (id, i)).collect();

    let states = alive
        .iter()
        .map(|&id| {
            let meta = doc.state_meta(id).expect("alive state has meta");
            PdaStateDto {
                label: doc.state_label(id).expect("alive state has label").to_string(),
                x: meta.x,
                y: meta.y,
                accepting: meta.accepting,
            }
        })
        .collect();

    let mut transitions: Vec<PdaTransitionDto> = doc
        .transitions()
        .map(|(_, t)| {
            let input = t.input.map(|s| doc.input_symbol_label(s).expect("interned input has a label").to_string());
            let pop: Vec<String> =
                t.pop.iter().map(|s| doc.stack_symbol_label(*s).expect("interned stack symbol has a label").to_string()).collect();
            let push: Vec<String> =
                t.push.iter().map(|s| doc.stack_symbol_label(*s).expect("interned stack symbol has a label").to_string()).collect();
            PdaTransitionDto { from: index_of[&t.from], to: index_of[&t.to], input, pop, push }
        })
        .collect();
    transitions.sort_by(|a, b| (a.from, a.to, &a.input, &a.pop, &a.push).cmp(&(b.from, b.to, &b.input, &b.pop, &b.push)));

    let initial = doc.initial_state().map(|id| index_of[&id]);

    PdaDto { states, transitions, initial }
}

/// Reconstruct a `PdaDoc` from its DTO, allocating fresh `StateId`s in
/// `states` array order.
pub fn pda_from_dto(dto: &PdaDto) -> Result<PdaDoc, DtoError> {
    let mut doc = PdaDoc::new();
    let mut ids = Vec::with_capacity(dto.states.len());
    for s in &dto.states {
        let id = doc.add_state(&s.label, s.x, s.y).map_err(|_| DtoError::InvalidStateIndex(ids.len()))?;
        doc.set_accepting(id, s.accepting);
        ids.push(id);
    }
    for t in &dto.transitions {
        let from = *ids.get(t.from).ok_or(DtoError::InvalidStateIndex(t.from))?;
        let to = *ids.get(t.to).ok_or(DtoError::InvalidStateIndex(t.to))?;
        let input = t.input.as_deref().map(|l| doc.intern_input_symbol(l));
        let pop: Vec<_> = t.pop.iter().map(|l| doc.intern_stack_symbol(l)).collect();
        let push: Vec<_> = t.push.iter().map(|l| doc.intern_stack_symbol(l)).collect();
        doc.add_transition(from, to, input, pop, push);
    }
    if let Some(idx) = dto.initial {
        let id = *ids.get(idx).ok_or(DtoError::InvalidStateIndex(idx))?;
        doc.set_initial(Some(id));
    }
    Ok(doc)
}

pub fn pda_save_to_string(doc: &PdaDoc) -> Result<String, DtoError> {
    let envelope = Envelope { version: CURRENT_VERSION, document: MachineDoc::Pda(pda_to_dto(doc)) };
    Ok(serde_json::to_string_pretty(&envelope)?)
}

pub fn pda_load_from_str(s: &str) -> Result<PdaDoc, DtoError> {
    let envelope: Envelope = serde_json::from_str(s)?;
    if envelope.version != CURRENT_VERSION {
        return Err(DtoError::UnsupportedVersion(envelope.version));
    }
    match envelope.document {
        MachineDoc::Pda(dto) => pda_from_dto(&dto),
        MachineDoc::Fa(_) => Err(DtoError::WrongKind { expected: "Pda", found: "Fa" }),
        MachineDoc::Mealy(_) => Err(DtoError::WrongKind { expected: "Pda", found: "Mealy" }),
        MachineDoc::Moore(_) => Err(DtoError::WrongKind { expected: "Pda", found: "Moore" }),
        MachineDoc::Tm(_) => Err(DtoError::WrongKind { expected: "Pda", found: "Tm" }),
    }
}

/// Project a `TmDoc` into its serializable DTO — same "positional index,
/// sorted for reproducibility" rules as `pda_to_dto`: transitions are a flat
/// list (each individually addressable, see `model::tm`'s doc comment)
/// sorted by `(from, to, tapes-as-strings)`.
pub fn tm_to_dto(doc: &TmDoc) -> TmDto {
    let alive: Vec<StateId> = doc.states().collect();
    let index_of: HashMap<StateId, usize> = alive.iter().enumerate().map(|(i, &id)| (id, i)).collect();

    let states = alive
        .iter()
        .map(|&id| {
            let meta = doc.state_meta(id).expect("alive state has meta");
            TmStateDto {
                label: doc.state_label(id).expect("alive state has label").to_string(),
                x: meta.x,
                y: meta.y,
                accepting: meta.accepting,
            }
        })
        .collect();

    let mut transitions: Vec<TmTransitionDto> = doc
        .transitions()
        .map(|(_, t)| {
            let tapes = t
                .tapes
                .iter()
                .map(|op| TmTapeOpDto {
                    read: doc.symbol_label(op.read).expect("interned symbol has a label").to_string(),
                    write: doc.symbol_label(op.write).expect("interned symbol has a label").to_string(),
                    direction: direction_to_str(op.direction).to_string(),
                })
                .collect();
            TmTransitionDto { from: index_of[&t.from], to: index_of[&t.to], tapes }
        })
        .collect();
    transitions.sort_by(|a, b| {
        let key = |t: &TmTransitionDto| {
            (t.from, t.to, t.tapes.iter().map(|op| (op.read.clone(), op.write.clone(), op.direction.clone())).collect::<Vec<_>>())
        };
        key(a).cmp(&key(b))
    });

    let initial = doc.initial_state().map(|id| index_of[&id]);

    TmDto { states, transitions, initial, tape_count: doc.tape_count() }
}

fn direction_to_str(d: crate::model::tm::Direction) -> &'static str {
    match d {
        crate::model::tm::Direction::Left => "L",
        crate::model::tm::Direction::Right => "R",
        crate::model::tm::Direction::Stay => "S",
    }
}

fn direction_from_str(s: &str) -> crate::model::tm::Direction {
    match s {
        "L" => crate::model::tm::Direction::Left,
        "R" => crate::model::tm::Direction::Right,
        _ => crate::model::tm::Direction::Stay,
    }
}

/// Reconstruct a `TmDoc` from its DTO, allocating fresh `StateId`s in
/// `states` array order. `tape_count` is not set explicitly — it's already
/// re-derived identically as a side effect of adding `transitions` in order
/// (the first one locks it in, same as `TmDoc::add_transition`'s own rule);
/// an empty-transitions document with a nonzero `dto.tape_count` (impossible
/// via `tm_to_dto`, but a hand-edited file could claim it) simply reloads as
/// `tape_count() == 0` again — harmless, since `tape_count` only matters once
/// a transition exists.
pub fn tm_from_dto(dto: &TmDto) -> Result<TmDoc, DtoError> {
    let mut doc = TmDoc::new();
    let mut ids = Vec::with_capacity(dto.states.len());
    for s in &dto.states {
        let id = doc.add_state(&s.label, s.x, s.y).map_err(|_| DtoError::InvalidStateIndex(ids.len()))?;
        doc.set_accepting(id, s.accepting);
        ids.push(id);
    }
    for t in &dto.transitions {
        let from = *ids.get(t.from).ok_or(DtoError::InvalidStateIndex(t.from))?;
        let to = *ids.get(t.to).ok_or(DtoError::InvalidStateIndex(t.to))?;
        let tapes: Vec<_> = t
            .tapes
            .iter()
            .map(|op| crate::model::tm::TmTapeOp {
                read: doc.intern_symbol(&op.read),
                write: doc.intern_symbol(&op.write),
                direction: direction_from_str(&op.direction),
            })
            .collect();
        doc.add_transition(from, to, tapes);
    }
    if let Some(idx) = dto.initial {
        let id = *ids.get(idx).ok_or(DtoError::InvalidStateIndex(idx))?;
        doc.set_initial(Some(id));
    }
    Ok(doc)
}

pub fn tm_save_to_string(doc: &TmDoc) -> Result<String, DtoError> {
    let envelope = Envelope { version: CURRENT_VERSION, document: MachineDoc::Tm(tm_to_dto(doc)) };
    Ok(serde_json::to_string_pretty(&envelope)?)
}

pub fn tm_load_from_str(s: &str) -> Result<TmDoc, DtoError> {
    let envelope: Envelope = serde_json::from_str(s)?;
    if envelope.version != CURRENT_VERSION {
        return Err(DtoError::UnsupportedVersion(envelope.version));
    }
    match envelope.document {
        MachineDoc::Tm(dto) => tm_from_dto(&dto),
        MachineDoc::Fa(_) => Err(DtoError::WrongKind { expected: "Tm", found: "Fa" }),
        MachineDoc::Mealy(_) => Err(DtoError::WrongKind { expected: "Tm", found: "Mealy" }),
        MachineDoc::Moore(_) => Err(DtoError::WrongKind { expected: "Tm", found: "Moore" }),
        MachineDoc::Pda(_) => Err(DtoError::WrongKind { expected: "Tm", found: "Pda" }),
    }
}

/// A runtime document of any machine kind, returned by `any_load_from_str`.
/// This is the runtime-model counterpart of the wire-level `MachineDoc`
/// boundary enum: same five kinds, but holding the reconstructed `*Doc`
/// model each per-kind loader already produces, rather than its DTO.
#[derive(Debug, Clone, PartialEq)]
pub enum AnyMachineDoc {
    Fa(crate::model::fa::FaDoc),
    Mealy(crate::model::mealy::MealyDoc),
    Moore(crate::model::moore::MooreDoc),
    Pda(crate::model::pda::PdaDoc),
    Tm(crate::model::tm::TmDoc),
}

/// Load a single-document envelope (the existing `{version, document}`
/// shape) without knowing its kind ahead of time, dispatching to the
/// matching existing per-kind loader based on the `document.kind` tag.
/// Used later (legacy `.jflap`/`.json` file detection) to tell a
/// single-document file apart from a multi-tab project file, per design
/// decision D5: a legacy envelope has a top-level `document` key, a project
/// envelope has a top-level `tabs` key — these are disjoint required keys,
/// so this function fails (rather than panicking) on a project-shaped
/// input, exactly like `serde_json` failing any other shape mismatch.
pub fn any_load_from_str(s: &str) -> Result<AnyMachineDoc, DtoError> {
    let envelope: Envelope = serde_json::from_str(s)?;
    if envelope.version != CURRENT_VERSION {
        return Err(DtoError::UnsupportedVersion(envelope.version));
    }
    match envelope.document {
        MachineDoc::Fa(dto) => fa_from_dto(&dto).map(AnyMachineDoc::Fa),
        MachineDoc::Mealy(dto) => mealy_from_dto(&dto).map(AnyMachineDoc::Mealy),
        MachineDoc::Moore(dto) => moore_from_dto(&dto).map(AnyMachineDoc::Moore),
        MachineDoc::Pda(dto) => pda_from_dto(&dto).map(AnyMachineDoc::Pda),
        MachineDoc::Tm(dto) => tm_from_dto(&dto).map(AnyMachineDoc::Tm),
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

    mod any_load {
        use super::*;
        use crate::model::tm::TmDoc;

        #[test]
        fn dispatches_a_legacy_fa_envelope_to_the_fa_variant() {
            let doc = build_doc(1, vec![], None);
            let json = save_to_string(&doc).unwrap();
            let loaded = any_load_from_str(&json).unwrap();
            assert!(matches!(loaded, AnyMachineDoc::Fa(_)));
        }

        #[test]
        fn dispatches_a_legacy_tm_envelope_to_the_tm_variant() {
            let doc = TmDoc::new();
            let json = tm_save_to_string(&doc).unwrap();
            let loaded = any_load_from_str(&json).unwrap();
            assert!(matches!(loaded, AnyMachineDoc::Tm(_)));
        }

        #[test]
        fn unsupported_version_fails_with_a_clear_error() {
            let json = r#"{"version":2,"document":{"kind":"Fa","states":[],"edges":[],"initial":null}}"#;
            let err = any_load_from_str(json).unwrap_err();
            assert!(matches!(err, DtoError::UnsupportedVersion(2)));
        }

        #[test]
        fn malformed_json_fails_without_panicking() {
            assert!(any_load_from_str("not json at all").is_err());
            assert!(any_load_from_str(r#"{"version":1,"document":{"#).is_err());
            assert!(any_load_from_str(r#"{"version":1,"tabs":[]}"#).is_err());
        }
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

    mod mealy {
        use super::*;

        fn build_mealy_doc(
            num_states: usize,
            edge_specs: Vec<(usize, usize, Vec<(String, String)>)>,
            initial: Option<usize>,
        ) -> MealyDoc {
            let mut doc = MealyDoc::new();
            let mut ids = Vec::with_capacity(num_states);
            for i in 0..num_states {
                ids.push(doc.add_state(&format!("s{i}"), i as f64, (i * 2) as f64).unwrap());
            }
            if num_states > 0 {
                for (from_idx, to_idx, pairs) in edge_specs {
                    let from = ids[from_idx % num_states];
                    let to = ids[to_idx % num_states];
                    for (input, output) in pairs {
                        doc.add_transition(from, to, &input, &output);
                    }
                }
                if let Some(idx) = initial {
                    doc.set_initial(Some(ids[idx % num_states]));
                }
            }
            doc
        }

        #[test]
        fn envelope_carries_the_mealy_kind_tag() {
            let doc = build_mealy_doc(1, vec![], None);
            let json = mealy_save_to_string(&doc).unwrap();
            let value: serde_json::Value = serde_json::from_str(&json).unwrap();
            assert_eq!(value["version"].as_u64(), Some(1));
            assert_eq!(value["document"]["kind"].as_str(), Some("Mealy"));
        }

        #[test]
        fn loading_a_fa_document_as_mealy_fails_with_a_clear_error() {
            let fa_json = save_to_string(&build_doc(1, vec![], None)).unwrap();
            let err = mealy_load_from_str(&fa_json).unwrap_err();
            assert!(matches!(err, DtoError::WrongKind { expected: "Mealy", found: "Fa" }));
        }

        #[test]
        fn loading_a_mealy_document_as_fa_fails_with_a_clear_error() {
            let mealy_json = mealy_save_to_string(&build_mealy_doc(1, vec![], None)).unwrap();
            let err = load_from_str(&mealy_json).unwrap_err();
            assert!(matches!(err, DtoError::WrongKind { expected: "Fa", found: "Mealy" }));
        }

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(256))]

            /// Same "save-then-load is an identity" invariant as FA's own
            /// `save_load_round_trip_is_identity`, one level over for the
            /// Mealy DTO/envelope pair.
            #[test]
            fn save_load_round_trip_is_identity(
                num_states in 0usize..12,
                edge_specs in prop::collection::vec(
                    (
                        0usize..12,
                        0usize..12,
                        prop::collection::vec(("[a-b]", "[x-y]"), 0..3)
                            .prop_map(|v| v.into_iter().map(|(i, o)| (i.to_string(), o.to_string())).collect::<Vec<_>>()),
                    ),
                    0..10,
                ),
                initial in prop::option::of(0usize..12),
            ) {
                let doc = build_mealy_doc(num_states, edge_specs, initial);
                let json = mealy_save_to_string(&doc).unwrap();
                let reloaded = mealy_load_from_str(&json).unwrap();
                prop_assert_eq!(mealy_to_dto(&doc), mealy_to_dto(&reloaded));
            }
        }
    }

    mod moore {
        use super::*;
        use crate::model::moore::MooreDoc;

        fn build_moore_doc(
            num_states: usize,
            state_outputs: Vec<Option<String>>,
            edge_specs: Vec<(usize, usize, Vec<String>)>,
            initial: Option<usize>,
        ) -> MooreDoc {
            let mut doc = MooreDoc::new();
            let mut ids = Vec::with_capacity(num_states);
            for i in 0..num_states {
                let id = doc.add_state(&format!("s{i}"), i as f64, (i * 2) as f64).unwrap();
                if let Some(Some(output)) = state_outputs.get(i) {
                    let output_id = doc.intern_output_symbol(output);
                    doc.set_output(id, Some(output_id));
                }
                ids.push(id);
            }
            if num_states > 0 {
                for (from_idx, to_idx, inputs) in edge_specs {
                    let from = ids[from_idx % num_states];
                    let to = ids[to_idx % num_states];
                    for input in inputs {
                        doc.add_transition(from, to, &input);
                    }
                }
                if let Some(idx) = initial {
                    doc.set_initial(Some(ids[idx % num_states]));
                }
            }
            doc
        }

        #[test]
        fn envelope_carries_the_moore_kind_tag() {
            let doc = build_moore_doc(1, vec![], vec![], None);
            let json = moore_save_to_string(&doc).unwrap();
            let value: serde_json::Value = serde_json::from_str(&json).unwrap();
            assert_eq!(value["version"].as_u64(), Some(1));
            assert_eq!(value["document"]["kind"].as_str(), Some("Moore"));
        }

        #[test]
        fn loading_a_fa_document_as_moore_fails_with_a_clear_error() {
            let fa_json = save_to_string(&build_doc(1, vec![], None)).unwrap();
            let err = moore_load_from_str(&fa_json).unwrap_err();
            assert!(matches!(err, DtoError::WrongKind { expected: "Moore", found: "Fa" }));
        }

        #[test]
        fn loading_a_mealy_document_as_moore_fails_with_a_clear_error() {
            let mut mealy_doc = crate::model::mealy::MealyDoc::new();
            mealy_doc.add_state("s0", 0.0, 0.0).unwrap();
            let mealy_json = mealy_save_to_string(&mealy_doc).unwrap();
            let err = moore_load_from_str(&mealy_json).unwrap_err();
            assert!(matches!(err, DtoError::WrongKind { expected: "Moore", found: "Mealy" }));
        }

        #[test]
        fn loading_a_moore_document_as_fa_fails_with_a_clear_error() {
            let moore_json = moore_save_to_string(&build_moore_doc(1, vec![], vec![], None)).unwrap();
            let err = load_from_str(&moore_json).unwrap_err();
            assert!(matches!(err, DtoError::WrongKind { expected: "Fa", found: "Moore" }));
        }

        #[test]
        fn state_output_round_trips_through_save_and_load() {
            let doc = build_moore_doc(2, vec![Some("even".into()), Some("odd".into())], vec![], None);
            let json = moore_save_to_string(&doc).unwrap();
            let reloaded = moore_load_from_str(&json).unwrap();
            assert_eq!(moore_to_dto(&doc), moore_to_dto(&reloaded));
        }

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(256))]

            /// Same "save-then-load is an identity" invariant as FA's/Mealy's
            /// own round-trip proptests, one level over for the Moore
            /// DTO/envelope pair.
            #[test]
            fn save_load_round_trip_is_identity(
                num_states in 0usize..12,
                state_outputs in prop::collection::vec(prop::option::of("[x-y]"), 0..12),
                edge_specs in prop::collection::vec(
                    (
                        0usize..12,
                        0usize..12,
                        prop::collection::vec("[a-b]", 0..3),
                    ),
                    0..10,
                ),
                initial in prop::option::of(0usize..12),
            ) {
                let doc = build_moore_doc(num_states, state_outputs, edge_specs, initial);
                let json = moore_save_to_string(&doc).unwrap();
                let reloaded = moore_load_from_str(&json).unwrap();
                prop_assert_eq!(moore_to_dto(&doc), moore_to_dto(&reloaded));
            }
        }
    }

    mod pda {
        use super::*;
        use crate::model::pda::PdaDoc;

        fn build_pda_doc(
            num_states: usize,
            accepting: Vec<bool>,
            transition_specs: Vec<(usize, usize, Option<String>, Vec<String>, Vec<String>)>,
            initial: Option<usize>,
        ) -> PdaDoc {
            let mut doc = PdaDoc::new();
            let mut ids = Vec::with_capacity(num_states);
            for i in 0..num_states {
                let id = doc.add_state(&format!("s{i}"), i as f64, (i * 2) as f64).unwrap();
                if accepting.get(i).copied().unwrap_or(false) {
                    doc.set_accepting(id, true);
                }
                ids.push(id);
            }
            if num_states > 0 {
                for (from_idx, to_idx, input, pop, push) in transition_specs {
                    let from = ids[from_idx % num_states];
                    let to = ids[to_idx % num_states];
                    let input_id = input.as_deref().map(|l| doc.intern_input_symbol(l));
                    let pop_ids: Vec<_> = pop.iter().map(|l| doc.intern_stack_symbol(l)).collect();
                    let push_ids: Vec<_> = push.iter().map(|l| doc.intern_stack_symbol(l)).collect();
                    doc.add_transition(from, to, input_id, pop_ids, push_ids);
                }
                if let Some(idx) = initial {
                    doc.set_initial(Some(ids[idx % num_states]));
                }
            }
            doc
        }

        #[test]
        fn envelope_carries_the_pda_kind_tag() {
            let doc = build_pda_doc(1, vec![], vec![], None);
            let json = pda_save_to_string(&doc).unwrap();
            let value: serde_json::Value = serde_json::from_str(&json).unwrap();
            assert_eq!(value["version"].as_u64(), Some(1));
            assert_eq!(value["document"]["kind"].as_str(), Some("Pda"));
        }

        #[test]
        fn loading_a_fa_document_as_pda_fails_with_a_clear_error() {
            let fa_json = save_to_string(&build_doc(1, vec![], None)).unwrap();
            let err = pda_load_from_str(&fa_json).unwrap_err();
            assert!(matches!(err, DtoError::WrongKind { expected: "Pda", found: "Fa" }));
        }

        #[test]
        fn loading_a_pda_document_as_fa_fails_with_a_clear_error() {
            let pda_json = pda_save_to_string(&build_pda_doc(1, vec![], vec![], None)).unwrap();
            let err = load_from_str(&pda_json).unwrap_err();
            assert!(matches!(err, DtoError::WrongKind { expected: "Fa", found: "Pda" }));
        }

        #[test]
        fn accepting_and_multiple_transitions_between_the_same_pair_round_trip_through_save_and_load() {
            let doc = build_pda_doc(
                2,
                vec![false, true],
                vec![
                    (0, 1, Some("a".into()), vec![], vec!["A".into()]),
                    (0, 1, None, vec!["Z".into()], vec![]),
                ],
                Some(0),
            );
            assert_eq!(doc.transitions().count(), 2, "both transitions between the same (from,to) must survive");
            let json = pda_save_to_string(&doc).unwrap();
            let reloaded = pda_load_from_str(&json).unwrap();
            assert_eq!(pda_to_dto(&doc), pda_to_dto(&reloaded));
        }

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(256))]

            /// Same "save-then-load is an identity" invariant as FA's/
            /// Mealy's/Moore's own round-trip proptests, one level over for
            /// the Pda DTO/envelope pair.
            #[test]
            fn save_load_round_trip_is_identity(
                num_states in 0usize..10,
                accepting in prop::collection::vec(any::<bool>(), 0..10),
                transition_specs in prop::collection::vec(
                    (
                        0usize..10,
                        0usize..10,
                        prop::option::of("[a-b]"),
                        prop::collection::vec("[x-y]", 0..2),
                        prop::collection::vec("[x-y]", 0..2),
                    ),
                    0..10,
                ),
                initial in prop::option::of(0usize..10),
            ) {
                let doc = build_pda_doc(num_states, accepting, transition_specs, initial);
                let json = pda_save_to_string(&doc).unwrap();
                let reloaded = pda_load_from_str(&json).unwrap();
                prop_assert_eq!(pda_to_dto(&doc), pda_to_dto(&reloaded));
            }
        }
    }

    mod tm {
        use super::*;
        use crate::model::tm::{Direction, TmDoc, TmTapeOp};

        fn build_tm_doc(
            num_states: usize,
            accepting: Vec<bool>,
            transition_specs: Vec<(usize, usize, Vec<(String, String, Direction)>)>,
            initial: Option<usize>,
        ) -> TmDoc {
            let mut doc = TmDoc::new();
            let mut ids = Vec::with_capacity(num_states);
            for i in 0..num_states {
                let id = doc.add_state(&format!("s{i}"), i as f64, (i * 2) as f64).unwrap();
                if accepting.get(i).copied().unwrap_or(false) {
                    doc.set_accepting(id, true);
                }
                ids.push(id);
            }
            if num_states > 0 {
                for (from_idx, to_idx, tape_specs) in transition_specs {
                    if tape_specs.is_empty() {
                        continue;
                    }
                    let from = ids[from_idx % num_states];
                    let to = ids[to_idx % num_states];
                    let tapes: Vec<TmTapeOp> = tape_specs
                        .iter()
                        .map(|(r, w, d)| TmTapeOp { read: doc.intern_symbol(r), write: doc.intern_symbol(w), direction: *d })
                        .collect();
                    // A mismatched arity is legitimately rejected by
                    // `add_transition` itself (no-op) — this proptest lets
                    // that happen naturally rather than pre-filtering.
                    doc.add_transition(from, to, tapes);
                }
                if let Some(idx) = initial {
                    doc.set_initial(Some(ids[idx % num_states]));
                }
            }
            doc
        }

        fn direction_strategy() -> impl Strategy<Value = Direction> {
            prop_oneof![Just(Direction::Left), Just(Direction::Right), Just(Direction::Stay)]
        }

        #[test]
        fn envelope_carries_the_tm_kind_tag() {
            let doc = build_tm_doc(1, vec![], vec![], None);
            let json = tm_save_to_string(&doc).unwrap();
            let value: serde_json::Value = serde_json::from_str(&json).unwrap();
            assert_eq!(value["version"].as_u64(), Some(1));
            assert_eq!(value["document"]["kind"].as_str(), Some("Tm"));
        }

        #[test]
        fn loading_a_fa_document_as_tm_fails_with_a_clear_error() {
            let fa_json = save_to_string(&build_doc(1, vec![], None)).unwrap();
            let err = tm_load_from_str(&fa_json).unwrap_err();
            assert!(matches!(err, DtoError::WrongKind { expected: "Tm", found: "Fa" }));
        }

        #[test]
        fn loading_a_tm_document_as_fa_fails_with_a_clear_error() {
            let tm_json = tm_save_to_string(&build_tm_doc(1, vec![], vec![], None)).unwrap();
            let err = load_from_str(&tm_json).unwrap_err();
            assert!(matches!(err, DtoError::WrongKind { expected: "Fa", found: "Tm" }));
        }

        #[test]
        fn tape_count_multiple_transitions_and_directions_round_trip() {
            let doc = build_tm_doc(
                2,
                vec![false, true],
                vec![
                    (0, 1, vec![("a".into(), "b".into(), Direction::Right)]),
                    (0, 1, vec![("b".into(), "a".into(), Direction::Left)]),
                ],
                Some(0),
            );
            assert_eq!(doc.transitions().count(), 2, "both transitions between the same (from,to) must survive");
            assert_eq!(doc.tape_count(), 1);
            let json = tm_save_to_string(&doc).unwrap();
            let reloaded = tm_load_from_str(&json).unwrap();
            assert_eq!(reloaded.tape_count(), 1);
            assert_eq!(tm_to_dto(&doc), tm_to_dto(&reloaded));
        }

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(256))]

            /// Same "save-then-load is an identity" invariant as every other
            /// machine kind's own round-trip proptest, one level over for
            /// the Tm DTO/envelope pair. All synthesized transitions use a
            /// single tape (so none get rejected by the tape-count lock),
            /// keeping this proptest's focus on the serialization identity
            /// rather than `TmDoc::add_transition`'s own validation (already
            /// covered by `model::tm`'s and `tm_doc`'s own unit tests).
            #[test]
            fn save_load_round_trip_is_identity(
                num_states in 0usize..10,
                accepting in prop::collection::vec(any::<bool>(), 0..10),
                transition_specs in prop::collection::vec(
                    (
                        0usize..10,
                        0usize..10,
                        ("[a-b]", "[x-y]", direction_strategy()).prop_map(|(r, w, d)| vec![(r.to_string(), w.to_string(), d)]),
                    ),
                    0..10,
                ),
                initial in prop::option::of(0usize..10),
            ) {
                let doc = build_tm_doc(num_states, accepting, transition_specs, initial);
                let json = tm_save_to_string(&doc).unwrap();
                let reloaded = tm_load_from_str(&json).unwrap();
                prop_assert_eq!(tm_to_dto(&doc), tm_to_dto(&reloaded));
            }
        }
    }
}
