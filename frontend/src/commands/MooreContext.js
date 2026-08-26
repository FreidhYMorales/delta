// Shared UI state for the Moore editor — same role as `MealyContext.js`,
// a separate, deliberately smaller class for the same reasons: none of
// `ViewContext`'s regex/grammar/convert/testing hooks apply, and
// `renameState`'s collision-notice logic is the only piece worth sharing
// (already generic — see `renameState.js`'s own doc comment).
//
// Differs from `MealyContext` in exactly the ways `MooreDoc` differs from
// `MealyDoc`: `promptInput` replaces `promptTransition` (a Moore edge only
// needs one input symbol, no "input/output" pair — the output lives on the
// state), and a new `promptOutput` hook exists for setting a state's output
// (nothing equivalent on `MealyContext`, Mealy has no per-state output).

import { wasRenamed } from "./renameState.js";
import { showNotice } from "../ui/notice.js";
import { applyGreekSymbols } from "../store/greekSymbols.js";

/**
 * @typedef {{kind:'state', id:number}|{kind:'edge', from:number, to:number}|null} MooreSelection
 */

export class MooreContext {
  /**
   * @param {import('../store/MooreDocStore.js').MooreDocStore} docStore
   * @param {{
   *   viewport?: {zoomIn: Function, zoomOut: Function, reset: Function, fitToWindow: Function},
   *   promptLabel?: (stateId: number) => Promise<string|null>,
   *   promptInput?: (existing?: string) => Promise<string|null>,
   *   promptOutput?: (stateId: number) => Promise<string|null>,
   *   renameState?: (id: number, label: string) => Promise<boolean>,
   *   openFile?: () => Promise<void>,
   *   saveFile?: () => Promise<void>,
   * }} hooks
   */
  constructor(docStore, hooks = {}) {
    this.docStore = docStore;
    this.activeTool = "select";
    /** @type {MooreSelection} */
    this.selection = null;
    this._listeners = new Set();

    this.viewport = hooks.viewport ?? noopViewport();
    this.promptLabel = hooks.promptLabel ?? (async () => null);
    // Prompts for a single input symbol (e.g. "a") — no "input/output" pair
    // like Mealy's `promptTransition`, since Moore's output lives on the
    // destination state, not the edge.
    this.promptInput = hooks.promptInput ?? (async () => null);
    // Prompts for a state's output string, used by the `state.setOutput`
    // registry action (`mooreRegistry.js`).
    this.promptOutput = hooks.promptOutput ?? (async () => null);
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
    // Native JSON only (no `.jff` for Moore yet, same scope note as Mealy)
    // — safe no-op defaults so this is testable without a real Tauri webview.
    this.openFile = hooks.openFile ?? (async () => {});
    this.saveFile = hooks.saveFile ?? (async () => {});
  }

  /** @param {(ctx: MooreContext) => void} listener @returns {() => void} */
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

  /** @param {MooreSelection} selection */
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
