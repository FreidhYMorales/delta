// Shared UI state for the PDA editor — same role as `MooreContext.js`, a
// separate, deliberately smaller class for the same reasons: none of
// `ViewContext`'s regex/grammar/convert/testing hooks apply, and
// `renameState`'s collision-notice logic is the only piece worth sharing
// (already generic — see `renameState.js`'s own doc comment).
//
// Differs from `MooreContext` in exactly the ways `PdaDoc` differs from
// `MooreDoc`: no `promptOutput` (PDA has no per-state output — instead
// `accepting` is a plain boolean toggle, no prompt needed at all, see
// `pdaRegistry.js`'s `state.toggleAccepting`), and `promptInput` is joined
// by two new hooks, `promptPop`/`promptPush`, since a PDA transition needs
// three fields (`input`, `pop`, `push`), not Moore's one. The three are
// always driven together via `pdaRegistry.js`'s `promptTransitionTriple`
// helper — cancelling any one of the three aborts the whole op, so no
// partial transition is ever created.

import { wasRenamed } from "./renameState.js";
import { showNotice } from "../ui/notice.js";
import { applyGreekSymbols } from "../store/greekSymbols.js";

/**
 * @typedef {{kind:'state', id:number}|{kind:'transition', id:number}|null} PdaSelection
 */

export class PdaContext {
  /**
   * @param {import('../store/PdaDocStore.js').PdaDocStore} docStore
   * @param {{
   *   viewport?: {zoomIn: Function, zoomOut: Function, reset: Function, fitToWindow: Function},
   *   promptLabel?: (stateId: number) => Promise<string|null>,
   *   promptInput?: (existing?: string) => Promise<string|null>,
   *   promptPop?: (existing?: string) => Promise<string|null>,
   *   promptPush?: (existing?: string) => Promise<string|null>,
   *   renameState?: (id: number, label: string) => Promise<boolean>,
   *   openFile?: () => Promise<void>,
   *   saveFile?: () => Promise<void>,
   * }} [hooks]
   */
  constructor(docStore, hooks = {}) {
    this.docStore = docStore;
    this.activeTool = "select";
    /** @type {PdaSelection} */
    this.selection = null;
    this._listeners = new Set();

    this.viewport = hooks.viewport ?? noopViewport();
    this.promptLabel = hooks.promptLabel ?? (async () => null);
    // The three fields of a transition — see `pdaRegistry.js`'s
    // `promptTransitionTriple` for how these three are sequenced together.
    this.promptInput = hooks.promptInput ?? (async () => null);
    this.promptPop = hooks.promptPop ?? (async () => null);
    this.promptPush = hooks.promptPush ?? (async () => null);
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
    // Native JSON only (no `.jff` for PDA yet, same scope note as Mealy/
    // Moore) — safe no-op defaults so this is testable without a real
    // Tauri webview.
    this.openFile = hooks.openFile ?? (async () => {});
    this.saveFile = hooks.saveFile ?? (async () => {});
  }

  /** @param {(ctx: PdaContext) => void} listener @returns {() => void} */
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

  /** @param {PdaSelection} selection */
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
