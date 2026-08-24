// Shared UI state for the TM editor — same role as `PdaContext.js`, a
// separate, deliberately smaller class for the same reasons: none of
// `ViewContext`'s regex/grammar/convert/testing hooks apply.
//
// Differs from `PdaContext` in exactly the ways `TmDoc` differs from
// `PdaDoc`: no `promptInput`/`promptPop`/`promptPush` triple — instead one
// `promptTape(index, existing)` hook parameterized by tape index, since a TM
// transition's field count varies with tape count (1 to 5), unlike PDA's
// fixed three fields (see `tmRegistry.js`'s `promptTransitionTapes`).
// `accepting` stays a plain boolean toggle, same as PDA's (`state.rename`).
//
// New, no PDA equivalent: `tapeCountChoice`/`setTapeCountChoice` — the
// frontend's own pre-lock tape-count choice. `TmDoc::tape_count` is `0`
// until the first transition is ever added, then locked forever
// (`model::tm.rs`'s doc comment), so the UI needs somewhere to hold "how
// many tapes should new transitions have" before that lock exists —
// `TmToolbar`'s tape-count `<select>` reads/writes this, and
// `tmLogic.js`'s `effectiveTapeCount` falls back to it whenever
// `docStore.derived.tape_count` is still 0.

import { wasRenamed } from "./renameState.js";
import { showNotice } from "../ui/notice.js";

/**
 * @typedef {{kind:'state', id:number}|{kind:'transition', id:number}|null} TmSelection
 */

export class TmContext {
  /**
   * @param {import('../store/TmDocStore.js').TmDocStore} docStore
   * @param {{
   *   viewport?: {zoomIn: Function, zoomOut: Function, reset: Function, fitToWindow: Function},
   *   promptLabel?: (stateId: number) => Promise<string|null>,
   *   promptTape?: (index: number, existing: string) => Promise<string|null>,
   *   renameState?: (id: number, label: string) => Promise<boolean>,
   *   openFile?: () => Promise<void>,
   *   saveFile?: () => Promise<void>,
   * }} [hooks]
   */
  constructor(docStore, hooks = {}) {
    this.docStore = docStore;
    this.activeTool = "select";
    /** @type {TmSelection} */
    this.selection = null;
    /** Pre-lock tape-count choice — see this module's header comment. */
    this.tapeCountChoice = 1;
    this._listeners = new Set();

    this.viewport = hooks.viewport ?? noopViewport();
    this.promptLabel = hooks.promptLabel ?? (async () => null);
    // One hook parameterized by tape index — see `tmRegistry.js`'s
    // `promptTransitionTapes` for how it's looped across every tape.
    this.promptTape = hooks.promptTape ?? (async () => null);
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
            `"${label}" is already used by another state` + (before ? ` — "${before}" was not renamed.` : "."),
        });
        return false;
      });
    // Native JSON only (no `.jff` for TM), same as PDA/Mealy/Moore — safe
    // no-op defaults so this is testable without a real Tauri webview.
    this.openFile = hooks.openFile ?? (async () => {});
    this.saveFile = hooks.saveFile ?? (async () => {});
  }

  /** @param {(ctx: TmContext) => void} listener @returns {() => void} */
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

  /** @param {TmSelection} selection */
  setSelection(selection) {
    this.selection = selection;
    this._notify();
  }

  clearSelection() {
    this.setSelection(null);
  }

  /** @param {number} n */
  setTapeCountChoice(n) {
    this.tapeCountChoice = n;
    this._notify();
  }
}

function noopViewport() {
  return { zoomIn() {}, zoomOut() {}, reset() {}, fitToWindow() {} };
}
