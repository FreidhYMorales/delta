// Shared UI state for the Mealy editor — same role as `ViewContext.js`
// (active tool + selection, read/written by `MealyDiagramView`), but a
// separate, deliberately smaller class: none of `ViewContext`'s
// regex/grammar/convert/testing hooks apply to a Mealy document, and
// `renameState`'s collision-notice logic is the only piece worth sharing
// (it's already generic — see `renameState.js`'s own doc comment).

import { wasRenamed } from "./renameState.js";
import { showNotice } from "../ui/notice.js";
import { applyGreekSymbols } from "../store/greekSymbols.js";

/**
 * @typedef {{kind:'state', id:number}|{kind:'edge', from:number, to:number}|null} MealySelection
 */

export class MealyContext {
  /**
   * @param {import('../store/MealyDocStore.js').MealyDocStore} docStore
   * @param {{
   *   viewport?: {zoomIn: Function, zoomOut: Function, reset: Function, fitToWindow: Function},
   *   promptLabel?: (stateId: number) => Promise<string|null>,
   *   promptTransition?: (existing?: string) => Promise<string|null>,
   *   renameState?: (id: number, label: string) => Promise<boolean>,
   *   openFile?: () => Promise<void>,
   *   saveFile?: () => Promise<void>,
   * }} hooks
   */
  constructor(docStore, hooks = {}) {
    this.docStore = docStore;
    this.activeTool = "select";
    /** @type {MealySelection} */
    this.selection = null;
    this._listeners = new Set();

    this.viewport = hooks.viewport ?? noopViewport();
    this.promptLabel = hooks.promptLabel ?? (async () => null);
    // Prompts for one "input/output" pair as a single string (e.g. "a/x") —
    // same compact notation `automata-cli mealy-sim`'s own examples and
    // docs/decisions.md use, parsed by `parseTransitionPrompt`
    // (`MealyDiagramView.js`).
    this.promptTransition = hooks.promptTransition ?? (async () => null);
    this.renameState =
      hooks.renameState ??
      (async (id, label) => {
        label = label ? applyGreekSymbols(label) : label;
        const before = docStore.getState(id)?.label;
        const result = await docStore.apply([{ op: "RenameState", id, label }]);
        if (wasRenamed(result.patches, id)) return true;
        showNotice({
          kind: "error",
          title: "Rename blocked",
          message:
            `"${label}" is already used by another state` + (before ? ` — "${before}" was not renamed.` : "."),
        });
        return false;
      });
    // Native JSON only (no `.jff` for Mealy yet) — safe no-op defaults so
    // this is testable without a real Tauri webview, same rationale as
    // every other hook here.
    this.openFile = hooks.openFile ?? (async () => {});
    this.saveFile = hooks.saveFile ?? (async () => {});
  }

  /** @param {(ctx: MealyContext) => void} listener @returns {() => void} */
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

  /** @param {MealySelection} selection */
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
