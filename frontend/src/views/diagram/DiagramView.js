// L0: the canvas + 4 core tools + selection inspector + status summary
// (task 7.4, design D6). SVG renderer only — the design's canvas-2D impl
// for >300 states (D6's stated crossover point) is an explicit non-goal of
// this PR; `<=300 states` is this view's only supported range for now.
//
// All tool switching and keyboard shortcuts dispatch through the single
// command registry (`commands/registry.js`) — see `_dispatchKey` — so this
// view never maintains a second, parallel key-to-behavior map (task 7.2's
// structural guarantee extends to this view's own input handling, not just
// the toolbar buttons).

import { TOOL_IDS, findAction, findByKeybinding, keybindingOf } from "../../commands/registry.js";
import { circleLayout, edgeEndpoints, nextStateLabel, statusSummary } from "./geometry.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const STATE_RADIUS = 20;
const BASE_WIDTH = 600;
const BASE_HEIGHT = 400;

const TOOL_NAMES = {
  "tool.select": "select",
  "tool.createState": "create-state",
  "tool.createTransition": "create-transition",
  "tool.delete": "delete",
};

export class DiagramView {
  /**
   * @param {HTMLElement} container
   * @param {import('../../store/DocStore.js').DocStore} docStore
   * @param {import('../../commands/context.js').ViewContext} ctx
   */
  constructor(container, docStore, ctx) {
    this.container = container;
    this.docStore = docStore;
    this.ctx = ctx;
    /** Transient "from" state while drawing a transition (create-transition tool). */
    this._pendingFrom = null;
    /** Transient drag state while the select tool moves a state (bug 1):
     * `{ id, startClientX, startClientY, startX, startY, x, y }`, or `null`
     * when no drag is in progress. Position deltas are computed from raw
     * pointer coordinates, never `getBoundingClientRect`, so this works the
     * same regardless of canvas scroll/zoom/test-environment layout. */
    this._dragState = null;
    /** Currently open right-click context menu element, or `null` (bug 3). */
    this._contextMenu = null;
    /** Pan/zoom state backing the SVG `viewBox` (task 7.1's registry
     * view.zoomIn/zoomOut/zoomReset/fitToWindow actions). */
    this._view = { x: 0, y: 0, w: BASE_WIDTH, h: BASE_HEIGHT };
    this.viewport = {
      zoomIn: () => this._zoomBy(1 / 1.2),
      zoomOut: () => this._zoomBy(1.2),
      reset: () => this._setViewBox(0, 0, BASE_WIDTH, BASE_HEIGHT),
      fitToWindow: () => this._fitToWindow(),
    };

    this._buildStaticDom();
    docStore.subscribe(() => this._render());
    ctx.subscribe(() => this._render());
    this._render();
  }

  _setViewBox(x, y, w, h) {
    this._view = { x, y, w, h };
    this.svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
  }

  _zoomBy(factor) {
    const { x, y, w, h } = this._view;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const nw = w * factor;
    const nh = h * factor;
    this._setViewBox(cx - nw / 2, cy - nh / 2, nw, nh);
  }

  _fitToWindow() {
    const states = this.docStore.getStates();
    if (!states.length) {
      this._setViewBox(0, 0, BASE_WIDTH, BASE_HEIGHT);
      return;
    }
    const xs = states.map((s) => s.x);
    const ys = states.map((s) => s.y);
    const pad = STATE_RADIUS * 2;
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad;
    const maxY = Math.max(...ys) + pad;
    this._setViewBox(minX, minY, Math.max(maxX - minX, 1), Math.max(maxY - minY, 1));
  }

  _buildStaticDom() {
    this.root = document.createElement("div");
    this.root.className = "diagram-view";

    this.toolbar = document.createElement("div");
    this.toolbar.className = "toolbar";
    this.toolbar.setAttribute("role", "toolbar");
    this._toolButtons = new Map();
    for (const id of TOOL_IDS) {
      const action = findAction(id);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tool-button";
      button.dataset.action = id;
      button.textContent = action.title;
      button.addEventListener("click", () => action.run(this.ctx));
      this.toolbar.appendChild(button);
      this._toolButtons.set(id, button);
    }

    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("class", "diagram-canvas");
    this.svg.setAttribute("tabindex", "0");
    this.svg.setAttribute("width", "600");
    this.svg.setAttribute("height", "400");
    this.svg.setAttribute("viewBox", `0 0 ${BASE_WIDTH} ${BASE_HEIGHT}`);
    this.svg.addEventListener("click", (e) => this._onCanvasClick(e));
    this.svg.addEventListener("keydown", (e) => this._dispatchKey(e));
    this.svg.addEventListener("mousedown", (e) => this._onCanvasMouseDown(e));
    this.svg.addEventListener("mousemove", (e) => this._onCanvasMouseMove(e));
    this.svg.addEventListener("mouseup", (e) => this._onCanvasMouseUp(e));
    this.svg.addEventListener("mouseleave", () => this._cancelDrag());
    this.svg.addEventListener("contextmenu", (e) => this._onCanvasContextMenu(e));

    this.inspector = document.createElement("div");
    this.inspector.className = "selection-inspector";

    this.statusBar = document.createElement("div");
    this.statusBar.className = "status-bar";

    this.root.append(this.toolbar, this.svg, this.inspector, this.statusBar);
    this.container.appendChild(this.root);
  }

  /** Single input-dispatch path: normalize the key, look it up in the
   * registry, and run whatever action (if any) claims it. No behavior is
   * ever wired directly to a raw key here. */
  _dispatchKey(event) {
    const action = findByKeybinding(keybindingOf(event));
    if (action && action.when(this.ctx)) action.run(this.ctx);
  }

  _onCanvasClick(event) {
    const rect = this.svg.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const target = event.target;
    const stateId = target?.dataset?.stateId ? Number(target.dataset.stateId) : null;
    const edgeKey = target?.dataset?.edge ?? null;

    switch (this.ctx.activeTool) {
      case "create-state":
        if (stateId == null) {
          this.docStore.apply([
            { op: "AddState", label: nextStateLabel(this.docStore.getStates()), x, y },
          ]);
        }
        break;
      case "select":
        if (stateId != null) {
          this.ctx.setSelection({ kind: "state", id: stateId });
        } else if (edgeKey) {
          const [from, to] = edgeKey.split(":").map(Number);
          this.ctx.setSelection({ kind: "edge", from, to });
        } else {
          this.ctx.clearSelection();
        }
        break;
      case "delete":
        if (stateId != null) {
          this.docStore.apply([{ op: "RemoveState", id: stateId }]);
        } else if (edgeKey) {
          const [from, to] = edgeKey.split(":").map(Number);
          this.docStore.apply([{ op: "SetEdge", from, to, epsilon: false, symbols: [] }]);
        }
        break;
      case "create-transition":
        if (stateId != null) this._lastEditPromise = this._handleCreateTransitionClick(stateId);
        break;
      default:
        break;
    }
  }

  /** Start a drag when the select tool mouse-downs directly on a state
   * circle (bug 1: select-and-drag is core L0 behavior, kflap-v0.1's
   * "V Seleccionar y mover estados"). The `click` handler above still fires
   * on release and re-selects the same state; that is harmless. */
  _onCanvasMouseDown(event) {
    if (this.ctx.activeTool !== "select") return;
    const stateId = event.target?.dataset?.stateId ? Number(event.target.dataset.stateId) : null;
    if (stateId == null) return;
    const state = this.docStore.getState(stateId);
    if (!state) return;
    this._dragState = {
      id: stateId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: state.x,
      startY: state.y,
      x: state.x,
      y: state.y,
    };
  }

  /** Local optimistic geometry update during the drag — mutates the
   * `DocStore` mirror directly and re-renders, without round-tripping to
   * the server on every mousemove (design D3: "drag preview is
   * frontend-local"). The authoritative `MoveState` op is only sent once,
   * on release (`_onCanvasMouseUp`). */
  _onCanvasMouseMove(event) {
    if (!this._dragState) return;
    const drag = this._dragState;
    const x = drag.startX + (event.clientX - drag.startClientX);
    const y = drag.startY + (event.clientY - drag.startClientY);
    drag.x = x;
    drag.y = y;
    const state = this.docStore.getState(drag.id);
    if (state) {
      state.x = x;
      state.y = y;
      this._render();
    }
  }

  /** Commit the drag as a single undoable `MoveState` transaction (design
   * D3: "one `MoveStates` op committed on pointerup — also the undo
   * granularity"). A drag that never moved is a no-op: no history entry,
   * no round trip. */
  _onCanvasMouseUp() {
    const drag = this._dragState;
    this._dragState = null;
    if (!drag) return;
    if (drag.x === drag.startX && drag.y === drag.startY) return;
    this.docStore.apply([{ op: "MoveState", id: drag.id, x: drag.x, y: drag.y }]);
  }

  /** Abort an in-progress drag without committing (e.g. the pointer leaves
   * the canvas). The local optimistic geometry stays wherever it was last
   * moved to — same as releasing outside the canvas would in most editors —
   * but no server round trip happens for a cancelled drag. */
  _cancelDrag() {
    this._dragState = null;
  }

  /** Right-click on a state circle: select it, suppress the native browser
   * menu, and show a small context menu of the applicable registry actions
   * (bug 3). Sourced from `commands/registry.js` — nothing here defines its
   * own action, matching design D6's "nothing bypasses the registry"
   * guarantee already tested for the toolbar/keyboard paths. */
  _onCanvasContextMenu(event) {
    const stateId = event.target?.dataset?.stateId ? Number(event.target.dataset.stateId) : null;
    if (stateId == null) return;
    event.preventDefault();
    this.ctx.setSelection({ kind: "state", id: stateId });
    this._showContextMenu(event.clientX, event.clientY, [
      "state.rename",
      "state.markInitial",
      "state.toggleAccepting",
      "edit.deleteSelection",
    ]);
  }

  _showContextMenu(x, y, actionIds) {
    this._closeContextMenu();

    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    for (const id of actionIds) {
      const action = findAction(id);
      if (!action || !action.when(this.ctx)) continue;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "context-menu-item";
      item.dataset.action = id;
      item.textContent = action.title;
      item.addEventListener("click", () => {
        action.run(this.ctx);
        this._closeContextMenu();
      });
      menu.appendChild(item);
    }

    document.body.appendChild(menu);
    this._contextMenu = menu;
    this._onDocMousedown = (e) => {
      if (!menu.contains(e.target)) this._closeContextMenu();
    };
    this._onDocKeydown = (e) => {
      if (e.key === "Escape") this._closeContextMenu();
    };
    // Capture phase so the menu can close itself before any other handler
    // (e.g. this same canvas's own mousedown-based drag start) reacts to
    // the same click.
    document.addEventListener("mousedown", this._onDocMousedown, true);
    document.addEventListener("keydown", this._onDocKeydown, true);
  }

  _closeContextMenu() {
    if (!this._contextMenu) return;
    this._contextMenu.remove();
    this._contextMenu = null;
    document.removeEventListener("mousedown", this._onDocMousedown, true);
    document.removeEventListener("keydown", this._onDocKeydown, true);
  }

  /** @returns {Promise<void>} — exposed via `this._lastEditPromise` (set by
   * the caller) so tests can await the prompt + apply round trip
   * deterministically instead of racing microtasks, same pattern as
   * `TableView`/`FormalView`'s `_lastEditPromise` (bug 2: prompts are now
   * async, backed by `promptModal` instead of `window.prompt`). */
  async _handleCreateTransitionClick(stateId) {
    if (this._pendingFrom == null) {
      this._pendingFrom = stateId;
      return;
    }
    const from = this._pendingFrom;
    this._pendingFrom = null;
    const symbol = await this.ctx.promptSymbol();
    if (!symbol) return;
    const existing = this.docStore.getEdge(from, stateId);
    const symbols = existing ? [...new Set([...existing.symbols, symbol])] : [symbol];
    await this.docStore.apply([
      { op: "SetEdge", from, to: stateId, epsilon: existing?.epsilon ?? false, symbols },
    ]);
  }

  _render() {
    this._renderToolbar();
    this._renderCanvas();
    this._renderInspector();
    this._renderStatusBar();
  }

  _renderToolbar() {
    for (const [id, button] of this._toolButtons) {
      button.classList.toggle("active", TOOL_NAMES[id] === this.ctx.activeTool);
    }
  }

  _renderCanvas() {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);

    const states = this.docStore.getStates();
    const positions = new Map(states.map((s) => [s.id, { x: s.x, y: s.y }]));

    for (const edge of this.docStore.getEdges()) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      const geo = edgeEndpoints(from, to, STATE_RADIUS);
      const el = document.createElementNS(SVG_NS, geo.selfLoop ? "circle" : "line");
      el.dataset.edge = `${edge.from}:${edge.to}`;
      if (geo.selfLoop) {
        el.setAttribute("cx", String(geo.x));
        el.setAttribute("cy", String(geo.y - STATE_RADIUS * 1.5));
        el.setAttribute("r", String(STATE_RADIUS * 0.6));
        el.setAttribute("fill", "none");
      } else {
        el.setAttribute("x1", String(geo.x1));
        el.setAttribute("y1", String(geo.y1));
        el.setAttribute("x2", String(geo.x2));
        el.setAttribute("y2", String(geo.y2));
      }
      el.setAttribute("class", "edge");
      if (this._isSelectedEdge(edge)) el.classList.add("selected");
      const label = document.createElementNS(SVG_NS, "text");
      label.textContent = edge.epsilon
        ? ["ε", ...edge.symbols].join(",")
        : edge.symbols.join(",");
      label.setAttribute("x", String((from.x + to.x) / 2));
      label.setAttribute("y", String((from.y + to.y) / 2 - 4));
      this.svg.append(el, label);
    }

    for (const state of states) {
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.dataset.stateId = String(state.id);
      circle.setAttribute("cx", String(state.x));
      circle.setAttribute("cy", String(state.y));
      circle.setAttribute("r", String(STATE_RADIUS));
      circle.setAttribute("class", "state");
      if (state.accepting) circle.classList.add("accepting");
      if (state.initial) circle.classList.add("initial");
      if ((this.docStore.derived.unreachable ?? []).includes(state.id)) {
        circle.classList.add("unreachable");
      }
      if (this._isSelectedState(state.id)) circle.classList.add("selected");
      circle.addEventListener("dblclick", () => {
        this._lastEditPromise = this._renameState(state.id);
      });

      const label = document.createElementNS(SVG_NS, "text");
      label.textContent = state.label;
      label.setAttribute("x", String(state.x));
      label.setAttribute("y", String(state.y));
      label.setAttribute("class", "state-label");

      this.svg.append(circle, label);
    }
  }

  /** @returns {Promise<void>} — see `_handleCreateTransitionClick`'s doc
   * comment for the `_lastEditPromise` convention. */
  async _renameState(id) {
    const label = await this.ctx.promptLabel(id);
    if (label) await this.docStore.apply([{ op: "RenameState", id, label }]);
  }

  _isSelectedState(id) {
    return this.ctx.selection?.kind === "state" && this.ctx.selection.id === id;
  }

  _isSelectedEdge(edge) {
    return (
      this.ctx.selection?.kind === "edge" &&
      this.ctx.selection.from === edge.from &&
      this.ctx.selection.to === edge.to
    );
  }

  _renderInspector() {
    const sel = this.ctx.selection;
    if (!sel) {
      this.inspector.textContent = "No selection";
      return;
    }
    if (sel.kind === "state") {
      const state = this.docStore.getState(sel.id);
      if (!state) {
        this.inspector.textContent = "No selection";
        return;
      }
      this.inspector.textContent =
        `State ${state.label} ` +
        `(#${state.id})` +
        (state.initial ? " · initial" : "") +
        (state.accepting ? " · accepting" : "");
    } else if (sel.kind === "edge") {
      const edge = this.docStore.getEdge(sel.from, sel.to);
      this.inspector.textContent = edge
        ? `Edge ${sel.from} -> ${sel.to}: ${edge.symbols.join(", ") || "ε"}`
        : "No selection";
    }
  }

  _renderStatusBar() {
    const summary = statusSummary({
      states: this.docStore.getStates(),
      edges: this.docStore.getEdges(),
      derived: this.docStore.derived,
    });
    const kind = summary.classification === "Dfa" ? "DFA" : "NFA";
    this.statusBar.textContent =
      `${kind} · Q=${summary.stateCount} · ` +
      `Σ=${summary.alphabetSize} · δ=${summary.transitionCount}` +
      (summary.unreachableCount > 0 ? ` · ${summary.unreachableCount} unreachable` : "");
  }
}
