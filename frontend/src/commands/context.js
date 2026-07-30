// Shared UI state (active tool + selection) that every registry action's
// `run(ctx)`/`when(ctx)` and every view (`DiagramView`/`TableView`/
// `FormalView`) reads and mutates through. One instance is created by the
// app shell (`main.js`) per open document and handed to every view, so
// selecting a state in the diagram is immediately visible to the L1 table
// and formal-definition views (task 7.5: "kept in sync with the diagram via
// DocStore") without those views needing to know about each other.

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
