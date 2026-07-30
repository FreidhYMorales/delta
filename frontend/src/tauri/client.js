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
