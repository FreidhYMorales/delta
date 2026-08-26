//! `sim_trace` / `sim_batch` (design D3, spec `fa-simulation`). Each call
//! returns one full bounded trace — never a per-step round trip — via
//! `engine::run_bounded` over a freshly compiled `FaEngine`. `Budget`
//! defaults to design D3's `max_steps: 10_000, max_configs: 5_000` when the
//! caller does not override it.

use serde::{Deserialize, Serialize};

use automata_core::engine::fa::FaEngine;
use automata_core::engine::{run_bounded, Budget, Outcome};
use automata_core::ids::SymbolId;
use automata_core::model::fa::FaDoc;

use crate::state::Session;
use crate::tabs::TabId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct BudgetDto {
    pub max_steps: usize,
    pub max_configs: usize,
}

impl From<BudgetDto> for Budget {
    fn from(b: BudgetDto) -> Self {
        Budget { max_steps: b.max_steps, max_configs: b.max_configs }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TraceDto {
    pub outcome: String,
    /// One entry per step; each entry is the sorted set of active state ids
    /// at that step (an FA `Config` is already the whole epsilon-closed
    /// subset, so this is the *complete* branching set — spec "NFA
    /// branching shown fully").
    pub steps: Vec<Vec<u32>>,
}

fn outcome_str(outcome: Outcome) -> &'static str {
    match outcome {
        Outcome::Accepted => "Accepted",
        Outcome::Rejected => "Rejected",
        Outcome::Stuck => "Stuck",
        Outcome::TruncatedSteps => "TruncatedSteps",
        Outcome::TruncatedConfigs => "TruncatedConfigs",
    }
}

/// Resolve each word symbol to its interned `SymbolId`, without mutating the
/// document. A symbol absent from the document's alphabet is given a
/// sentinel id that can never appear as a real transition's key (real ids
/// are dense, starting at 0), so it correctly fails to match any `delta`
/// entry rather than being silently treated as an existing symbol.
fn word_to_symbols(doc: &FaDoc, word: &[String]) -> Vec<SymbolId> {
    word.iter()
        .enumerate()
        .map(|(i, s)| doc.symbol_label_to_id(s).unwrap_or(SymbolId(u32::MAX - i as u32)))
        .collect()
}

fn trace_of(engine: &FaEngine, input: &[SymbolId], budget: Budget) -> TraceDto {
    let trace = run_bounded(engine, input, budget);
    TraceDto {
        outcome: outcome_str(trace.outcome).to_string(),
        steps: trace
            .steps
            .into_iter()
            .map(|step| {
                let mut ids: Vec<u32> =
                    step.configs.iter().flat_map(|cfg| cfg.0.ones().map(|i| i as u32)).collect();
                ids.sort();
                ids.dedup();
                ids
            })
            .collect(),
    }
}

/// Plain, directly-testable logic (short name, mirrors `commands::doc`'s
/// convention: plain fn takes `&Session`, the `#[tauri::command]` wrapper
/// below owns the literal design-mandated invoke name).
pub fn trace(session: &Session, tab: TabId, word: Vec<String>, budget: Option<BudgetDto>) -> Result<TraceDto, String> {
    session.try_with(tab, |doc| {
        let engine = FaEngine::compile(&doc.model);
        let input = word_to_symbols(&doc.model, &word);
        trace_of(&engine, &input, budget.map(Into::into).unwrap_or_default())
    })
}

/// Compiles the engine once and reuses it for every word (design D2: a
/// compile is cheap — sub-ms at 1000 states — but there is no reason to pay
/// it per word within a single batch call).
pub fn batch(
    session: &Session,
    tab: TabId,
    words: Vec<Vec<String>>,
    budget: Option<BudgetDto>,
) -> Result<Vec<TraceDto>, String> {
    session.try_with(tab, |doc| {
        let engine = FaEngine::compile(&doc.model);
        let b: Budget = budget.map(Into::into).unwrap_or_default();
        words
            .into_iter()
            .map(|word| {
                let input = word_to_symbols(&doc.model, &word);
                trace_of(&engine, &input, b)
            })
            .collect()
    })
}

#[tauri::command]
pub fn sim_trace(
    session: tauri::State<'_, Session>,
    tab_id: TabId,
    word: Vec<String>,
    budget: Option<BudgetDto>,
) -> Result<TraceDto, String> {
    trace(&session, tab_id, word, budget)
}

#[tauri::command]
pub fn sim_batch(
    session: tauri::State<'_, Session>,
    tab_id: TabId,
    words: Vec<Vec<String>>,
    budget: Option<BudgetDto>,
) -> Result<Vec<TraceDto>, String> {
    batch(&session, tab_id, words, budget)
}
