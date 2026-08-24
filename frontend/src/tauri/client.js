// Thin wrapper over the Tauri v2 IPC surface (design D3, PR4's
// `src-tauri/src/commands/{doc,sim,jff}.rs`). Every exported function name
// and payload shape here mirrors the exact `#[tauri::command]` name and
// argument names on the Rust side — this module is the single place the
// frontend is allowed to call `invoke()` from, so the wire contract only
// needs to be kept in sync in one spot.
//
// `invoke` is imported lazily (dynamic import) so this module — and
// everything that transitively imports it — can be loaded under Vitest
// (plain Node/jsdom, no Tauri webview `window.__TAURI_INTERNALS__`) without
// throwing at import time. Calling any of these functions outside a real
// Tauri webview will reject; callers (DocStore) surface that as a normal
// rejected promise.

let invokePromise;

function getInvoke() {
  if (!invokePromise) {
    invokePromise = import("@tauri-apps/api/core").then((mod) => mod.invoke);
  }
  return invokePromise;
}

async function call(command, args) {
  const invoke = await getInvoke();
  return invoke(command, args);
}

/** @returns {Promise<import('../store/DocStore.js').DocSnapshot>} */
export function docSnapshot() {
  return call("doc_snapshot");
}

/**
 * @param {Array<object>} ops EditOpDto[]
 * @returns {Promise<import('../store/DocStore.js').EditResult>}
 */
export function docApply(ops) {
  return call("doc_apply", { ops });
}

/** @returns {Promise<import('../store/DocStore.js').EditResult|null>} */
export function docUndo() {
  return call("doc_undo");
}

/** @returns {Promise<import('../store/DocStore.js').EditResult|null>} */
export function docRedo() {
  return call("doc_redo");
}

/** @param {string} path @returns {Promise<import('../store/DocStore.js').DocSnapshot>} */
export function docOpen(path) {
  return call("doc_open", { path });
}

/** @param {string} path @returns {Promise<void>} */
export function docSave(path) {
  return call("doc_save", { path });
}

/**
 * @param {string[]} word
 * @param {{max_steps: number, max_configs: number}|undefined} budget
 */
export function simTrace(word, budget) {
  return call("sim_trace", { word, budget });
}

/**
 * @param {string[][]} words
 * @param {{max_steps: number, max_configs: number}|undefined} budget
 */
export function simBatch(words, budget) {
  return call("sim_batch", { words, budget });
}

/** @param {string} path */
export function jffImport(path) {
  return call("jff_import", { path });
}

/** @param {string} path */
export function jffExport(path) {
  return call("jff_export", { path });
}

/** @returns {Promise<string>} the regular expression equivalent to the
 * session's current automaton (`∅`/`ε` included, unicode). */
export function convToRegex() {
  return call("conv_to_regex");
}

/**
 * Replaces the session's current document with the NFA built from
 * `pattern` (Thompson's construction) — rejects with the parser's own
 * Spanish, user-facing error message on invalid syntax.
 * @param {string} pattern
 * @returns {Promise<import('../store/DocStore.js').DocSnapshot>}
 */
export function convFromRegex(pattern) {
  return call("conv_from_regex", { pattern });
}

/** @returns {Promise<string>} the right-linear grammar equivalent to the
 * session's current automaton, in `grammar::format`'s syntax (not
 * `RegularGrammar`'s more compact `Display` — see the Rust doc comment on
 * `conv_to_grammar`), so it's always copy-paste-able back into
 * `convFromGrammar`. */
export function convToGrammar() {
  return call("conv_to_grammar");
}

/**
 * Replaces the session's current document with the NFA built from `text`
 * (a right-linear grammar, one production per line) — rejects with the
 * parser's own Spanish, user-facing error message on invalid syntax.
 * @param {string} text
 * @returns {Promise<import('../store/DocStore.js').DocSnapshot>}
 */
export function convFromGrammar(text) {
  return call("conv_from_grammar", { text });
}

/** @returns {Promise<import('../store/DocStore.js').DocSnapshot>} a preview
 * of the equivalent DFA (subset construction) — read-only, never mutates
 * the session; the caller (`ctx.convertToDfa`, `main.js`) diffs this
 * against the live document and applies the difference itself. */
export function convNfaToDfa() {
  return call("conv_nfa_to_dfa");
}

/**
 * @returns {Promise<import('../store/DocStore.js').DocSnapshot>} a preview
 * of the minimized DFA — rejects if the current automaton isn't already
 * deterministic (same message `automata-cli` prints, not new user-facing
 * copy — see the Rust doc comment on `conv_minimize_dfa`).
 */
export function convMinimizeDfa() {
  return call("conv_minimize_dfa");
}

// --- Mealy machine (src-tauri/src/commands/mealy.rs) — a genuinely
// separate document/session from the FA one above, same "isolated, not a
// variant" rationale as `MealyDoc` vs `FaDoc` (docs/decisions.md). ---------

/** @returns {Promise<import('../store/MealyDocStore.js').MealyDocSnapshot>} */
export function mealySnapshot() {
  return call("mealy_snapshot");
}

/**
 * @param {Array<object>} ops MealyEditOpDto[]
 * @returns {Promise<import('../store/MealyDocStore.js').MealyEditResult>}
 */
export function mealyApply(ops) {
  return call("mealy_apply", { ops });
}

/** @returns {Promise<import('../store/MealyDocStore.js').MealyEditResult|null>} */
export function mealyUndo() {
  return call("mealy_undo");
}

/** @returns {Promise<import('../store/MealyDocStore.js').MealyEditResult|null>} */
export function mealyRedo() {
  return call("mealy_redo");
}

/** @param {string} path @returns {Promise<import('../store/MealyDocStore.js').MealyDocSnapshot>} */
export function mealyOpen(path) {
  return call("mealy_open", { path });
}

/** @param {string} path @returns {Promise<void>} */
export function mealySave(path) {
  return call("mealy_save", { path });
}

/** @param {string[]} input @returns {Promise<object>} MealySimDto (tagged
 * on `outcome`: "Completed"|"NoInitialState"|"NoTransition"|"Ambiguous"). */
export function mealySim(input) {
  return call("mealy_sim", { input });
}

// --- Moore machine (src-tauri/src/commands/moore.rs) — a genuinely
// separate document/session from FA and Mealy, same "isolated, not a
// variant" rationale (docs/decisions.md, the Moore backend entry). ---------

/** @returns {Promise<import('../store/MooreDocStore.js').MooreDocSnapshot>} */
export function mooreSnapshot() {
  return call("moore_snapshot");
}

/**
 * @param {Array<object>} ops MooreEditOpDto[]
 * @returns {Promise<import('../store/MooreDocStore.js').MooreEditResult>}
 */
export function mooreApply(ops) {
  return call("moore_apply", { ops });
}

/** @returns {Promise<import('../store/MooreDocStore.js').MooreEditResult|null>} */
export function mooreUndo() {
  return call("moore_undo");
}

/** @returns {Promise<import('../store/MooreDocStore.js').MooreEditResult|null>} */
export function mooreRedo() {
  return call("moore_redo");
}

/** @param {string} path @returns {Promise<import('../store/MooreDocStore.js').MooreDocSnapshot>} */
export function mooreOpen(path) {
  return call("moore_open", { path });
}

/** @param {string} path @returns {Promise<void>} */
export function mooreSave(path) {
  return call("moore_save", { path });
}

/** @param {string[]} input @returns {Promise<object>} MooreSimDto (tagged
 * on `outcome`: "Completed"|"NoInitialState"|"NoTransition"|"Ambiguous").
 * `Completed.outputs` has length input.length+1 — the initial state's
 * output is emitted before consuming anything (see engine::moore's doc
 * comment / docs/decisions.md, the Moore backend entry). */
export function mooreSim(input) {
  return call("moore_sim", { input });
}

// --- Pushdown Automaton (src-tauri/src/commands/pda.rs) — a genuinely
// separate document/session; transitions are individually addressable, not
// grouped by (from,to) like FA/Mealy/Moore's edges (docs/decisions.md, the
// PDA Tauri IPC entry). ---------------------------------------------------

/** @returns {Promise<import('../store/PdaDocStore.js').PdaDocSnapshot>} */
export function pdaSnapshot() {
  return call("pda_snapshot");
}

/**
 * @param {Array<object>} ops PdaEditOpDto[]
 * @returns {Promise<import('../store/PdaDocStore.js').PdaEditResult>}
 */
export function pdaApply(ops) {
  return call("pda_apply", { ops });
}

/** @returns {Promise<import('../store/PdaDocStore.js').PdaEditResult|null>} */
export function pdaUndo() {
  return call("pda_undo");
}

/** @returns {Promise<import('../store/PdaDocStore.js').PdaEditResult|null>} */
export function pdaRedo() {
  return call("pda_redo");
}

/** @param {string} path @returns {Promise<import('../store/PdaDocStore.js').PdaDocSnapshot>} */
export function pdaOpen(path) {
  return call("pda_open", { path });
}

/** @param {string} path @returns {Promise<void>} */
export function pdaSave(path) {
  return call("pda_save", { path });
}

/**
 * @param {string[]} input
 * @param {"final"|"empty"} [acceptBy] the accept mode is a per-run choice,
 *   never document state (see docs/decisions.md, the PDA backend entry) —
 *   defaults server-side to "final" (`commands::pda::AcceptByDto`'s `Default`).
 * @param {{max_steps:number,max_configs:number}} [budget]
 * @returns {Promise<object>} PdaTraceDto ({outcome, steps: Array<Array<{state,stack}>>}).
 */
export function pdaSim(input, acceptBy, budget) {
  return call("pda_sim", { input, acceptBy, budget });
}

// --- Turing Machine (src-tauri/src/commands/tm.rs) — a genuinely separate
// document/session, same "isolated, not a variant" rationale as PDA's
// (docs/decisions.md). ONE alphabet (not PDA's two), and transitions carry
// `tapes: {read,write,direction}[]` instead of PDA's single triple —
// see `tm_ipc.rs`'s own doc comment. ---------------------------------------

/** @returns {Promise<import('../store/TmDocStore.js').TmDocSnapshot>} */
export function tmSnapshot() {
  return call("tm_snapshot");
}

/**
 * @param {Array<object>} ops TmEditOpDto[]
 * @returns {Promise<import('../store/TmDocStore.js').TmEditResult>}
 */
export function tmApply(ops) {
  return call("tm_apply", { ops });
}

/** @returns {Promise<import('../store/TmDocStore.js').TmEditResult|null>} */
export function tmUndo() {
  return call("tm_undo");
}

/** @returns {Promise<import('../store/TmDocStore.js').TmEditResult|null>} */
export function tmRedo() {
  return call("tm_redo");
}

/** @param {string} path @returns {Promise<import('../store/TmDocStore.js').TmDocSnapshot>} */
export function tmOpen(path) {
  return call("tm_open", { path });
}

/** @param {string} path @returns {Promise<void>} */
export function tmSave(path) {
  return call("tm_save", { path });
}

/**
 * @param {string[][]} inputs one word-array per tape (`run_tm`'s broadcast-
 *   or-per-tape convention — one array broadcasts to every tape, one array
 *   per tape gives each its own word — see `engine::tm::run_tm`'s doc
 *   comment; implemented and tested backend-side, not reimplemented here).
 * @param {"final"|"halting"} [acceptBy] the accept mode is a per-run choice,
 *   never document state, same as PDA's — defaults server-side to "final"
 *   (`commands::tm::AcceptByDto`'s `Default`). No PDA-style "empty" mode: a
 *   TM has no stack.
 * @param {{max_steps:number,max_configs:number}} [budget]
 * @returns {Promise<object>} TmTraceDto ({outcome, steps: Array<Array<{state,tapes}>>}).
 */
export function tmSim(inputs, acceptBy, budget) {
  return call("tm_sim", { inputs, acceptBy, budget });
}
