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
//
// `tabId` (design D14/PR9): every one of the 44 per-kind wrappers below now
// takes an optional trailing `tabId` — forwarded as the `tabId` arg key,
// which Tauri's default camelCase argument convention maps to the Rust
// side's `tab_id: Option<TabId>` (same convention this file already used
// for `pdaSim`/`tmSim`'s `acceptBy` <-> `accept_by`). Omitting it (every
// call site in this app today) keeps addressing the one seeded tab exactly
// like before PR9 — `bindFaTab`/`bindMealyTab`/`bindMooreTab`/`bindPdaTab`/
// `bindTmTab` (`../tauri/tabClient.js`, design D6) are what actually supply
// a real `tabId`, partial-applying it so existing stores/views never need
// to pass one themselves.

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

/** @param {number} [tabId] @returns {Promise<import('../store/DocStore.js').DocSnapshot>} */
export function docSnapshot(tabId) {
  return call("doc_snapshot", { tabId });
}

/**
 * @param {Array<object>} ops EditOpDto[]
 * @param {number} [tabId]
 * @returns {Promise<import('../store/DocStore.js').EditResult>}
 */
export function docApply(ops, tabId) {
  return call("doc_apply", { ops, tabId });
}

/** @param {number} [tabId] @returns {Promise<import('../store/DocStore.js').EditResult|null>} */
export function docUndo(tabId) {
  return call("doc_undo", { tabId });
}

/** @param {number} [tabId] @returns {Promise<import('../store/DocStore.js').EditResult|null>} */
export function docRedo(tabId) {
  return call("doc_redo", { tabId });
}

/** @param {string} path @param {number} [tabId] @returns {Promise<import('../store/DocStore.js').DocSnapshot>} */
export function docOpen(path, tabId) {
  return call("doc_open", { path, tabId });
}

/** @param {string} path @param {number} [tabId] @returns {Promise<void>} */
export function docSave(path, tabId) {
  return call("doc_save", { path, tabId });
}

/**
 * @param {string[]} word
 * @param {{max_steps: number, max_configs: number}|undefined} budget
 * @param {number} [tabId]
 */
export function simTrace(word, budget, tabId) {
  return call("sim_trace", { word, budget, tabId });
}

/**
 * @param {string[][]} words
 * @param {{max_steps: number, max_configs: number}|undefined} budget
 * @param {number} [tabId]
 */
export function simBatch(words, budget, tabId) {
  return call("sim_batch", { words, budget, tabId });
}

/** @param {string} path @param {number} [tabId] */
export function jffImport(path, tabId) {
  return call("jff_import", { path, tabId });
}

/** @param {string} path @param {number} [tabId] */
export function jffExport(path, tabId) {
  return call("jff_export", { path, tabId });
}

/** @param {number} [tabId] @returns {Promise<string>} the regular expression equivalent to the
 * session's current automaton (`∅`/`ε` included, unicode). */
export function convToRegex(tabId) {
  return call("conv_to_regex", { tabId });
}

/**
 * Replaces the session's current document with the NFA built from
 * `pattern` (Thompson's construction) — rejects with the parser's own
 * Spanish, user-facing error message on invalid syntax.
 * @param {string} pattern
 * @param {number} [tabId]
 * @returns {Promise<import('../store/DocStore.js').DocSnapshot>}
 */
export function convFromRegex(pattern, tabId) {
  return call("conv_from_regex", { pattern, tabId });
}

/** @param {number} [tabId] @returns {Promise<string>} the right-linear grammar equivalent to the
 * session's current automaton, in `grammar::format`'s syntax (not
 * `RegularGrammar`'s more compact `Display` — see the Rust doc comment on
 * `conv_to_grammar`), so it's always copy-paste-able back into
 * `convFromGrammar`. */
export function convToGrammar(tabId) {
  return call("conv_to_grammar", { tabId });
}

/**
 * Replaces the session's current document with the NFA built from `text`
 * (a right-linear grammar, one production per line) — rejects with the
 * parser's own Spanish, user-facing error message on invalid syntax.
 * @param {string} text
 * @param {number} [tabId]
 * @returns {Promise<import('../store/DocStore.js').DocSnapshot>}
 */
export function convFromGrammar(text, tabId) {
  return call("conv_from_grammar", { text, tabId });
}

/** @param {number} [tabId] @returns {Promise<import('../store/DocStore.js').DocSnapshot>} a preview
 * of the equivalent DFA (subset construction) — read-only, never mutates
 * the session; the caller (`ctx.convertToDfa`, `main.js`) diffs this
 * against the live document and applies the difference itself. */
export function convNfaToDfa(tabId) {
  return call("conv_nfa_to_dfa", { tabId });
}

/**
 * @param {number} [tabId]
 * @returns {Promise<import('../store/DocStore.js').DocSnapshot>} a preview
 * of the minimized DFA — rejects if the current automaton isn't already
 * deterministic (same message `automata-cli` prints, not new user-facing
 * copy — see the Rust doc comment on `conv_minimize_dfa`).
 */
export function convMinimizeDfa(tabId) {
  return call("conv_minimize_dfa", { tabId });
}

// --- Mealy machine (src-tauri/src/commands/mealy.rs) — a genuinely
// separate document/session from the FA one above, same "isolated, not a
// variant" rationale as `MealyDoc` vs `FaDoc` (docs/decisions.md). ---------

/** @param {number} [tabId] @returns {Promise<import('../store/MealyDocStore.js').MealyDocSnapshot>} */
export function mealySnapshot(tabId) {
  return call("mealy_snapshot", { tabId });
}

/**
 * @param {Array<object>} ops MealyEditOpDto[]
 * @param {number} [tabId]
 * @returns {Promise<import('../store/MealyDocStore.js').MealyEditResult>}
 */
export function mealyApply(ops, tabId) {
  return call("mealy_apply", { ops, tabId });
}

/** @param {number} [tabId] @returns {Promise<import('../store/MealyDocStore.js').MealyEditResult|null>} */
export function mealyUndo(tabId) {
  return call("mealy_undo", { tabId });
}

/** @param {number} [tabId] @returns {Promise<import('../store/MealyDocStore.js').MealyEditResult|null>} */
export function mealyRedo(tabId) {
  return call("mealy_redo", { tabId });
}

/** @param {string} path @param {number} [tabId] @returns {Promise<import('../store/MealyDocStore.js').MealyDocSnapshot>} */
export function mealyOpen(path, tabId) {
  return call("mealy_open", { path, tabId });
}

/** @param {string} path @param {number} [tabId] @returns {Promise<void>} */
export function mealySave(path, tabId) {
  return call("mealy_save", { path, tabId });
}

/** @param {string[]} input @param {number} [tabId] @returns {Promise<object>} MealySimDto (tagged
 * on `outcome`: "Completed"|"NoInitialState"|"NoTransition"|"Ambiguous"). */
export function mealySim(input, tabId) {
  return call("mealy_sim", { input, tabId });
}

// --- Moore machine (src-tauri/src/commands/moore.rs) — a genuinely
// separate document/session from FA and Mealy, same "isolated, not a
// variant" rationale (docs/decisions.md, the Moore backend entry). ---------

/** @param {number} [tabId] @returns {Promise<import('../store/MooreDocStore.js').MooreDocSnapshot>} */
export function mooreSnapshot(tabId) {
  return call("moore_snapshot", { tabId });
}

/**
 * @param {Array<object>} ops MooreEditOpDto[]
 * @param {number} [tabId]
 * @returns {Promise<import('../store/MooreDocStore.js').MooreEditResult>}
 */
export function mooreApply(ops, tabId) {
  return call("moore_apply", { ops, tabId });
}

/** @param {number} [tabId] @returns {Promise<import('../store/MooreDocStore.js').MooreEditResult|null>} */
export function mooreUndo(tabId) {
  return call("moore_undo", { tabId });
}

/** @param {number} [tabId] @returns {Promise<import('../store/MooreDocStore.js').MooreEditResult|null>} */
export function mooreRedo(tabId) {
  return call("moore_redo", { tabId });
}

/** @param {string} path @param {number} [tabId] @returns {Promise<import('../store/MooreDocStore.js').MooreDocSnapshot>} */
export function mooreOpen(path, tabId) {
  return call("moore_open", { path, tabId });
}

/** @param {string} path @param {number} [tabId] @returns {Promise<void>} */
export function mooreSave(path, tabId) {
  return call("moore_save", { path, tabId });
}

/** @param {string[]} input @param {number} [tabId] @returns {Promise<object>} MooreSimDto (tagged
 * on `outcome`: "Completed"|"NoInitialState"|"NoTransition"|"Ambiguous").
 * `Completed.outputs` has length input.length+1 — the initial state's
 * output is emitted before consuming anything (see engine::moore's doc
 * comment / docs/decisions.md, the Moore backend entry). */
export function mooreSim(input, tabId) {
  return call("moore_sim", { input, tabId });
}

// --- Pushdown Automaton (src-tauri/src/commands/pda.rs) — a genuinely
// separate document/session; transitions are individually addressable, not
// grouped by (from,to) like FA/Mealy/Moore's edges (docs/decisions.md, the
// PDA Tauri IPC entry). ---------------------------------------------------

/** @param {number} [tabId] @returns {Promise<import('../store/PdaDocStore.js').PdaDocSnapshot>} */
export function pdaSnapshot(tabId) {
  return call("pda_snapshot", { tabId });
}

/**
 * @param {Array<object>} ops PdaEditOpDto[]
 * @param {number} [tabId]
 * @returns {Promise<import('../store/PdaDocStore.js').PdaEditResult>}
 */
export function pdaApply(ops, tabId) {
  return call("pda_apply", { ops, tabId });
}

/** @param {number} [tabId] @returns {Promise<import('../store/PdaDocStore.js').PdaEditResult|null>} */
export function pdaUndo(tabId) {
  return call("pda_undo", { tabId });
}

/** @param {number} [tabId] @returns {Promise<import('../store/PdaDocStore.js').PdaEditResult|null>} */
export function pdaRedo(tabId) {
  return call("pda_redo", { tabId });
}

/** @param {string} path @param {number} [tabId] @returns {Promise<import('../store/PdaDocStore.js').PdaDocSnapshot>} */
export function pdaOpen(path, tabId) {
  return call("pda_open", { path, tabId });
}

/** @param {string} path @param {number} [tabId] @returns {Promise<void>} */
export function pdaSave(path, tabId) {
  return call("pda_save", { path, tabId });
}

/**
 * @param {string[]} input
 * @param {"final"|"empty"} [acceptBy] the accept mode is a per-run choice,
 *   never document state (see docs/decisions.md, the PDA backend entry) —
 *   defaults server-side to "final" (`commands::pda::AcceptByDto`'s `Default`).
 * @param {{max_steps:number,max_configs:number}} [budget]
 * @param {number} [tabId]
 * @returns {Promise<object>} PdaTraceDto ({outcome, steps: Array<Array<{state,stack}>>}).
 */
export function pdaSim(input, acceptBy, budget, tabId) {
  return call("pda_sim", { input, acceptBy, budget, tabId });
}

// --- Turing Machine (src-tauri/src/commands/tm.rs) — a genuinely separate
// document/session, same "isolated, not a variant" rationale as PDA's
// (docs/decisions.md). ONE alphabet (not PDA's two), and transitions carry
// `tapes: {read,write,direction}[]` instead of PDA's single triple —
// see `tm_ipc.rs`'s own doc comment. ---------------------------------------

/** @param {number} [tabId] @returns {Promise<import('../store/TmDocStore.js').TmDocSnapshot>} */
export function tmSnapshot(tabId) {
  return call("tm_snapshot", { tabId });
}

/**
 * @param {Array<object>} ops TmEditOpDto[]
 * @param {number} [tabId]
 * @returns {Promise<import('../store/TmDocStore.js').TmEditResult>}
 */
export function tmApply(ops, tabId) {
  return call("tm_apply", { ops, tabId });
}

/** @param {number} [tabId] @returns {Promise<import('../store/TmDocStore.js').TmEditResult|null>} */
export function tmUndo(tabId) {
  return call("tm_undo", { tabId });
}

/** @param {number} [tabId] @returns {Promise<import('../store/TmDocStore.js').TmEditResult|null>} */
export function tmRedo(tabId) {
  return call("tm_redo", { tabId });
}

/** @param {string} path @param {number} [tabId] @returns {Promise<import('../store/TmDocStore.js').TmDocSnapshot>} */
export function tmOpen(path, tabId) {
  return call("tm_open", { path, tabId });
}

/** @param {string} path @param {number} [tabId] @returns {Promise<void>} */
export function tmSave(path, tabId) {
  return call("tm_save", { path, tabId });
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
 * @param {number} [tabId]
 * @returns {Promise<object>} TmTraceDto ({outcome, steps: Array<Array<{state,tapes}>>}).
 */
export function tmSim(inputs, acceptBy, budget, tabId) {
  return call("tm_sim", { inputs, acceptBy, budget, tabId });
}

// --- Project (src-tauri/src/commands/project.rs) — the multi-tab project
// session commands (PR9 of `multi-tab-projects`, design D8/D14). Unlike the
// 44 per-kind wrappers above, none of these takes a `tabId`: they operate on
// the WHOLE project (every open tab at once); `projectCloseTab`/
// `projectRenameTab` address one specific tab through their own `tabId`
// argument instead, same as any other regular parameter. -------------------

/** @returns {Promise<import('../project/ProjectStore.js').ProjectManifest>} a
 * fresh, empty project — no tabs (`project_new_tab` is a separate, explicit
 * call, same as the Rust side's own doc comment on `new_project`). */
export function projectNew() {
  return call("project_new");
}

/** @returns {Promise<import('../project/ProjectStore.js').ProjectManifest>}
 * the current project's ordered tab list plus its live aggregate revision
 * (design D10) — read-only, never mutates anything. */
export function projectManifest() {
  return call("project_manifest");
}

/**
 * @param {string} kind `MachineKind` tag ("Fa"|"Mealy"|"Moore"|"Pda"|"Tm")
 * @param {string} name rejected (empty `Err`) if blank or a duplicate of an
 *   existing tab's name.
 * @returns {Promise<import('../project/ProjectStore.js').ProjectManifest>}
 */
export function projectNewTab(kind, name) {
  return call("project_new_tab", { kind, name });
}

/** @param {number} tabId @returns {Promise<import('../project/ProjectStore.js').ProjectManifest>} */
export function projectCloseTab(tabId) {
  return call("project_close_tab", { tabId });
}

/**
 * @param {number} tabId
 * @param {string} newName same empty/duplicate-name rejection as `projectNewTab`.
 * @returns {Promise<import('../project/ProjectStore.js').ProjectManifest>}
 */
export function projectRenameTab(tabId, newName) {
  return call("project_rename_tab", { tabId, newName });
}

/** @param {string} path @returns {Promise<import('../project/ProjectStore.js').ProjectManifest>}
 * replaces the current project entirely with the one read from `path`. */
export function projectOpen(path) {
  return call("project_open", { path });
}

/** @param {string} path @returns {Promise<import('../project/ProjectStore.js').ProjectManifest>}
 * serializes every open tab (in display order) to `path`. */
export function projectSave(path) {
  return call("project_save", { path });
}
