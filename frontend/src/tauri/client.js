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
