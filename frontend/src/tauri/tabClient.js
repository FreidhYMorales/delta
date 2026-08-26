// One partial-application binder PER machine kind (design D6) — deliberately
// NOT a single generic/shared implementation across kinds: this codebase has
// a twice-documented anti-cross-kind-generalization precedent
// (docs/decisions.md, "isolated, not a variant" — see e.g. `client.js`'s own
// section comments on `MealyDoc`/`MooreDoc`/`PdaDoc`/`TmDoc` each being kept
// a separate class rather than a generalized one).
//
// Each `bindXTab(client, tabId)` takes the SAME duck-typed `client` object
// every store/view already expects (`import * as client from "./client.js"`,
// wired in `main.js`) and returns a NEW object with the exact same method
// names, each one forwarding to the real IPC wrapper with `tabId`
// pre-bound as its trailing argument (`client.js`'s own tabId convention,
// PR9). Existing store/view files (~100 of them) therefore need ZERO
// changes — they keep calling the exact same duck-typed client shape they
// always have, just now backed by a tab-bound client instead of the global
// singleton `client` module.

/**
 * @param {typeof import('./client.js')} client
 * @param {number} tabId
 */
export function bindFaTab(client, tabId) {
  return {
    docSnapshot: () => client.docSnapshot(tabId),
    docApply: (ops) => client.docApply(ops, tabId),
    docUndo: () => client.docUndo(tabId),
    docRedo: () => client.docRedo(tabId),
    docOpen: (path) => client.docOpen(path, tabId),
    docSave: (path) => client.docSave(path, tabId),
    simTrace: (word, budget) => client.simTrace(word, budget, tabId),
    simBatch: (words, budget) => client.simBatch(words, budget, tabId),
    jffImport: (path) => client.jffImport(path, tabId),
    jffExport: (path) => client.jffExport(path, tabId),
    convToRegex: () => client.convToRegex(tabId),
    convFromRegex: (pattern) => client.convFromRegex(pattern, tabId),
    convToGrammar: () => client.convToGrammar(tabId),
    convFromGrammar: (text) => client.convFromGrammar(text, tabId),
    convNfaToDfa: () => client.convNfaToDfa(tabId),
    convMinimizeDfa: () => client.convMinimizeDfa(tabId),
  };
}

/**
 * @param {typeof import('./client.js')} client
 * @param {number} tabId
 */
export function bindMealyTab(client, tabId) {
  return {
    mealySnapshot: () => client.mealySnapshot(tabId),
    mealyApply: (ops) => client.mealyApply(ops, tabId),
    mealyUndo: () => client.mealyUndo(tabId),
    mealyRedo: () => client.mealyRedo(tabId),
    mealyOpen: (path) => client.mealyOpen(path, tabId),
    mealySave: (path) => client.mealySave(path, tabId),
    mealySim: (input) => client.mealySim(input, tabId),
  };
}

/**
 * @param {typeof import('./client.js')} client
 * @param {number} tabId
 */
export function bindMooreTab(client, tabId) {
  return {
    mooreSnapshot: () => client.mooreSnapshot(tabId),
    mooreApply: (ops) => client.mooreApply(ops, tabId),
    mooreUndo: () => client.mooreUndo(tabId),
    mooreRedo: () => client.mooreRedo(tabId),
    mooreOpen: (path) => client.mooreOpen(path, tabId),
    mooreSave: (path) => client.mooreSave(path, tabId),
    mooreSim: (input) => client.mooreSim(input, tabId),
  };
}

/**
 * @param {typeof import('./client.js')} client
 * @param {number} tabId
 */
export function bindPdaTab(client, tabId) {
  return {
    pdaSnapshot: () => client.pdaSnapshot(tabId),
    pdaApply: (ops) => client.pdaApply(ops, tabId),
    pdaUndo: () => client.pdaUndo(tabId),
    pdaRedo: () => client.pdaRedo(tabId),
    pdaOpen: (path) => client.pdaOpen(path, tabId),
    pdaSave: (path) => client.pdaSave(path, tabId),
    pdaSim: (input, acceptBy, budget) => client.pdaSim(input, acceptBy, budget, tabId),
  };
}

/**
 * @param {typeof import('./client.js')} client
 * @param {number} tabId
 */
export function bindTmTab(client, tabId) {
  return {
    tmSnapshot: () => client.tmSnapshot(tabId),
    tmApply: (ops) => client.tmApply(ops, tabId),
    tmUndo: () => client.tmUndo(tabId),
    tmRedo: () => client.tmRedo(tabId),
    tmOpen: (path) => client.tmOpen(path, tabId),
    tmSave: (path) => client.tmSave(path, tabId),
    tmSim: (inputs, acceptBy, budget) => client.tmSim(inputs, acceptBy, budget, tabId),
  };
}
