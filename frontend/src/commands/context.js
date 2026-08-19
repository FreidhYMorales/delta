// Shared UI state (active tool + selection) that every registry action's
// `run(ctx)`/`when(ctx)` and every view (`DiagramView`/`TableView`/
// `FormalView`) reads and mutates through. One instance is created by the
// app shell (`main.js`) per open document and handed to every view, so
// selecting a state in the diagram is immediately visible to the L1 table
// and formal-definition views (task 7.5: "kept in sync with the diagram via
// DocStore") without those views needing to know about each other.

import { wasRenamed } from "./renameState.js";
import { showNotice } from "../ui/notice.js";

/**
 * @typedef {{kind:'state', id:number}|{kind:'edge', from:number, to:number}|null} Selection
 */

export class ViewContext {
  /**
   * @param {import('../store/DocStore.js').DocStore} docStore
   * @param {{
   *   viewport?: {zoomIn: Function, zoomOut: Function, reset: Function, fitToWindow: Function},
   *   layout?: {circle: Function},
   *   promptPath?: (kind: 'open-jff'|'save-jff') => Promise<string|null>,
   *   promptLabel?: (stateId: number) => Promise<string|null>,
   *   promptSymbol?: () => Promise<string|null>,
   *   importJff?: (path: string) => Promise<void>,
   *   exportJff?: (path: string) => Promise<void>,
   *   simTrace?: (word: string[], budget?: object) => Promise<object>,
   *   simBatch?: (words: string[][], budget?: object) => Promise<object[]>,
   *   toRegex?: () => Promise<string>,
   *   testing?: {openSingle: Function, openBatch: Function},
   *   renameState?: (id: number, label: string) => Promise<boolean>,
   * }} hooks
   */
  constructor(docStore, hooks = {}) {
    this.docStore = docStore;
    this.activeTool = "select";
    /** @type {Selection} */
    this.selection = null;
    this._listeners = new Set();

    this.viewport = hooks.viewport ?? noopViewport();
    this.layout = hooks.layout ?? { circle: () => {} };
    this.promptPath = hooks.promptPath ?? (async () => null);
    this.promptLabel = hooks.promptLabel ?? (async () => null);
    this.promptSymbol = hooks.promptSymbol ?? (async () => null);
    this.importJff = hooks.importJff ?? (async () => {});
    this.exportJff = hooks.exportJff ?? (async () => {});
    // L2 testing drawer (task 7.6) — trace/batch execution and diagram
    // active-state highlighting are injectable, same rationale as the
    // prompt/interop hooks above (testable without a real Tauri webview).
    this.simTrace = hooks.simTrace ?? (async () => ({ outcome: "Rejected", steps: [] }));
    this.simBatch = hooks.simBatch ?? (async () => []);
    // First step towards the "Expresión Regular" editor mode (still
    // disabled in the Toolbar's mode select): a read-only derivation of the
    // regex equivalent to the current automaton, backed by
    // `automata_core::convert::fa_to_regex` — no real hook wired here means
    // no Tauri webview, so default to the same "∅" an empty document itself
    // derives to.
    this.toRegex = hooks.toRegex ?? (async () => "∅");
    this.testing = hooks.testing ?? { openSingle() {}, openBatch() {} };
    // Rename-collision notice (task 7.9, spec "State Identifier Conflicts
    // Are Never Silent"). Real by default (needs only `docStore` + a DOM
    // notice, both available without a Tauri webview) — overridable in
    // tests that want to assert on the raw `apply` call instead.
    this.renameState =
      hooks.renameState ??
      (async (id, label) => {
        const before = docStore.getState(id)?.label;
        const result = await docStore.apply([{ op: "RenameState", id, label }]);
        if (wasRenamed(result.patches, id)) return true;
        showNotice({
          kind: "error",
          title: "Rename blocked",
          message:
            `"${label}" is already used by another state` +
            (before ? ` — "${before}" was not renamed.` : "."),
        });
        return false;
      });
  }

  /** @param {(ctx: ViewContext) => void} listener @returns {() => void} */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _notify() {
    for (const listener of this._listeners) listener(this);
  }

  /** @param {string} tool */
  setTool(tool) {
    this.activeTool = tool;
    this.selection = null;
    this._notify();
  }

  /** @param {Selection} selection */
  setSelection(selection) {
    this.selection = selection;
    this._notify();
  }

  clearSelection() {
    this.setSelection(null);
  }
}

function noopViewport() {
  return { zoomIn() {}, zoomOut() {}, reset() {}, fitToWindow() {} };
}
