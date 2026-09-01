// Shared UI state (active tool + selection) that every registry action's
// `run(ctx)`/`when(ctx)` and every view (`DiagramView`/`TableView`/
// `FormalView`) reads and mutates through. One instance is created by the
// app shell (`main.js`) per open document and handed to every view, so
// selecting a state in the diagram is immediately visible to the L1 table
// and formal-definition views (task 7.5: "kept in sync with the diagram via
// DocStore") without those views needing to know about each other.

import { wasRenamed } from "./renameState.js";
import { showNotice } from "../ui/notice.js";
import { applyGreekSymbols } from "../store/greekSymbols.js";

/**
 * @typedef {{kind:'state', id:number}|{kind:'edge', from:number, to:number}|null} Selection
 */

export class ViewContext {
  /**
   * @param {import('../store/DocStore.js').DocStore} docStore
   * @param {{
   *   viewport?: {zoomIn: Function, zoomOut: Function, reset: Function, fitToWindow: Function},
   *   layout?: {arrange: Function},
   *   promptPath?: (kind: 'open-jff'|'save-jff') => Promise<string|null>,
   *   promptLabel?: (stateId: number) => Promise<string|null>,
   *   promptSymbol?: () => Promise<string|null>, // "" = epsilon requested, null = cancelled, non-empty = real symbol
   *   importJff?: (path: string) => Promise<void>,
   *   exportJff?: (path: string) => Promise<void>,
   *   simTrace?: (word: string[], budget?: object) => Promise<object>,
   *   simBatch?: (words: string[][], budget?: object) => Promise<object[]>,
   *   toRegex?: () => Promise<string>,
   *   fromRegex?: (pattern: string) => Promise<import('../store/DocStore.js').DocSnapshot>,
   *   toGrammar?: () => Promise<string>,
   *   fromGrammar?: (text: string) => Promise<import('../store/DocStore.js').DocSnapshot>,
   *   testing?: {openSingle: Function, openBatch: Function},
   *   convertToDfa?: () => Promise<void>,
   *   minimizeDfa?: () => Promise<void>,
   *   renameState?: (id: number, label: string) => Promise<boolean>,
   * }} hooks
   */
  constructor(docStore, hooks = {}) {
    this.docStore = docStore;
    this.activeTool = "select";
    /** @type {Selection} */
    this.selection = null;
    // Skip-edge dummy-node waypoints from the most recent "Organizar"
    // (`layeredLayout`'s `edgeWaypoints`, `views/diagram/geometry.js`),
    // keyed by the same `${from}:${to}` edge convention `DiagramView.js`
    // already uses — a snapshot of that ONE layout call, not a persisted
    // routing model. `DiagramView` clears it the instant the user starts
    // manually dragging a state (any drag, not just one touching a routed
    // edge — simpler to reason about than partial invalidation), so a
    // stale route never lingers past whatever positions it was computed
    // for; edges just revert to plain rendering until the next Organizar.
    this.edgeRoutes = new Map();
    this._listeners = new Set();

    this.viewport = hooks.viewport ?? noopViewport();
    this.layout = hooks.layout ?? { arrange: () => {} };
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
    // The other direction (regex -> a brand new FA document, replacing the
    // current one — `commands::convert::from_regex`, same "whole-document
    // swap" shape as opening a file). No safe client-side fallback exists
    // here (unlike `toRegex`'s "∅"): without a real hook there is nothing
    // sensible to generate, so the default just fails loudly instead of
    // pretending to succeed.
    this.fromRegex =
      hooks.fromRegex ?? (async () => { throw new Error("No hay conversión regex→autómata disponible."); });
    // Same pair, for the right-linear grammar direction (`GrammarView`) —
    // "" is the empty grammar `grammar::format` itself derives for an empty
    // document, same rationale as `toRegex`'s "∅" default.
    this.toGrammar = hooks.toGrammar ?? (async () => "");
    this.fromGrammar =
      hooks.fromGrammar ?? (async () => { throw new Error("No hay conversión gramática→autómata disponible."); });
    this.testing = hooks.testing ?? { openSingle() {}, openBatch() {} };
    // "Convertir" menu (`convert.toDfa`/`convert.minimizeDfa` — a menu
    // group of its own, MenuBar.js's MENU_GROUP_TITLES). Unlike
    // `toRegex`/`toGrammar`, FA->FA conversions are never a whole-document
    // replacement: the real hook (`main.js`) fetches a read-only preview
    // (`conv_nfa_to_dfa`/`conv_minimize_dfa`) and syncs the live document to
    // it through the normal `docStore.apply` undo/redo path
    // (`applyAutomatonModel`), so Ctrl+Z undoes a conversion exactly like
    // any other edit. No safe default (same reasoning as `fromRegex`).
    this.convertToDfa =
      hooks.convertToDfa ?? (async () => { throw new Error("No hay conversión AFN→AFD disponible."); });
    this.minimizeDfa =
      hooks.minimizeDfa ?? (async () => { throw new Error("No hay minimización de AFD disponible."); });
    // Rename-collision notice (task 7.9, spec "State Identifier Conflicts
    // Are Never Silent"). Real by default (needs only `docStore` + a DOM
    // notice, both available without a Tauri webview) — overridable in
    // tests that want to assert on the raw `apply` call instead.
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

  /** @param {Map<string, {x:number,y:number}[]>} routes */
  setEdgeRoutes(routes) {
    this.edgeRoutes = routes;
    this._notify();
  }

  /** No-op (no `_notify()`) when already empty — `DiagramView` calls this
   * unconditionally on every drag START, and its own subscriber is a full
   * canvas rebuild; notifying on the (common) case where there was nothing
   * to clear would force that full rebuild at the start of every single
   * drag, defeating the whole point of patching just the dragged state
   * during a drag (found by an actual regressed test: the drag-patch
   * "same DOM node" tests started failing once this call was wired in). */
  clearEdgeRoutes() {
    if (this.edgeRoutes.size === 0) return;
    this.edgeRoutes = new Map();
    this._notify();
  }
}

function noopViewport() {
  return { zoomIn() {}, zoomOut() {}, reset() {}, fitToWindow() {} };
}
