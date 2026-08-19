// Mealy machine canvas — same core interaction model as `DiagramView.js`
// (task 7.4's 4-tool L0 pattern: select/create-state/create-transition/
// delete, click-drag, pan/zoom), deliberately trimmed for v1: no registry-
// driven right-click context menu (`MealyContext` has no command registry
// of its own yet — see docs/decisions.md), no keyboard-shortcut dispatch.
// Reuses `views/diagram/geometry.js`'s pure curve/layout math directly
// (`circleLayout`/`edgeEndpoints`/`preferredLoopAngle`/`selfLoopPath`/
// `curvedEdgePath`/`nextStateLabel` have nothing FA-specific in their
// signatures) instead of re-deriving the same bidirectional/self-loop
// curve handling a second time.
//
// Differences from `DiagramView.js`, all traceable to `MealyDoc` itself:
//  - No accepting-state double circle — Mealy has no accepting states.
//  - Edge labels show `input/output` pairs (`formatTransitionEntries`),
//    not a flat symbol list.
//  - Creating a transition prompts once for "input/output" (`ctx.
//    promptTransition`, `parseTransitionPrompt`), not a single symbol.
//  - "Marcar como inicial" is a toolbar action here (`markInitial()`,
//    wired by `MealyToolbar`), not a context-menu item.

import {
  circleLayout,
  curvedEdgePath,
  edgeEndpoints,
  nextStateLabel,
  preferredLoopAngle,
  selfLoopPath,
} from "../diagram/geometry.js";
import { formatTransitionEntries, mergeTransitionEntry, parseTransitionPrompt } from "./mealyLogic.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const STATE_RADIUS = 20;
const BASE_WIDTH = 600;
const BASE_HEIGHT = 400;
const EDGE_LABEL_GAP = 12;

export class MealyDiagramView {
  /**
   * @param {HTMLElement} container
   * @param {import('../../store/MealyDocStore.js').MealyDocStore} docStore
   * @param {import('../../commands/MealyContext.js').MealyContext} ctx
   */
  constructor(container, docStore, ctx) {
    this.container = container;
    this.docStore = docStore;
    this.ctx = ctx;
    this._pendingFrom = null;
    this._dragState = null;
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

  _onWheel(event) {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1.1 : 1 / 1.1;
    const cursor = this._svgPoint(event.clientX, event.clientY);
    const { x, y, w, h } = this._view;
    const nw = w * factor;
    const nh = h * factor;
    const relX = (cursor.x - x) / w;
    const relY = (cursor.y - y) / h;
    this._setViewBox(cursor.x - relX * nw, cursor.y - relY * nh, nw, nh);
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
    this.root.className = "diagram-view mealy-diagram-view";

    this.canvasInfoBar = document.createElement("div");
    this.canvasInfoBar.className = "canvas-toolbar";
    this.canvasFileLabel = document.createElement("span");
    this.canvasStatusChip = document.createElement("span");
    this.canvasStatusChip.className = "chip";
    this.canvasInfoBar.append(this.canvasFileLabel, this.canvasStatusChip);

    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("class", "diagram-canvas");
    this.svg.setAttribute("tabindex", "0");
    this.svg.setAttribute("width", "600");
    this.svg.setAttribute("height", "400");
    this.svg.setAttribute("viewBox", `0 0 ${BASE_WIDTH} ${BASE_HEIGHT}`);
    this.svg.addEventListener("click", (e) => this._onCanvasClick(e));
    this.svg.addEventListener("mousedown", (e) => this._onCanvasMouseDown(e));
    this.svg.addEventListener("mousemove", (e) => this._onCanvasMouseMove(e));
    this.svg.addEventListener("mouseup", (e) => this._onCanvasMouseUp(e));
    this.svg.addEventListener("mouseleave", () => this._cancelDrag());
    this.svg.addEventListener("wheel", (e) => this._onWheel(e), { passive: false });

    const defs = document.createElementNS(SVG_NS, "defs");
    const marker = document.createElementNS(SVG_NS, "marker");
    marker.setAttribute("id", "mealy-arrow");
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "7");
    marker.setAttribute("markerHeight", "7");
    marker.setAttribute("orient", "auto-start-reverse");
    const arrowHead = document.createElementNS(SVG_NS, "path");
    arrowHead.setAttribute("d", "M0,0 L10,5 L0,10 z");
    arrowHead.setAttribute("class", "arrowhead");
    marker.appendChild(arrowHead);
    defs.appendChild(marker);
    this._defs = defs;
    this.svg.appendChild(defs);

    this.inspector = document.createElement("div");
    this.inspector.className = "selection-inspector";

    this.statusBar = document.createElement("div");
    this.statusBar.className = "status-bar";

    this.root.append(this.canvasInfoBar, this.svg, this.inspector, this.statusBar);
    this.container.appendChild(this.root);
  }

  _svgScale() {
    const rect = this.svg.getBoundingClientRect();
    return {
      x: rect.width > 0 ? this._view.w / rect.width : 1,
      y: rect.height > 0 ? this._view.h / rect.height : 1,
    };
  }

  _svgPoint(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    const scale = this._svgScale();
    return {
      x: this._view.x + (clientX - rect.left) * scale.x,
      y: this._view.y + (clientY - rect.top) * scale.y,
    };
  }

  _onCanvasClick(event) {
    const { x, y } = this._svgPoint(event.clientX, event.clientY);
    const target = event.target;
    const stateId = target?.dataset?.stateId ? Number(target.dataset.stateId) : null;
    const edgeKey = target?.dataset?.edge ?? null;

    switch (this.ctx.activeTool) {
      case "create-state":
        if (stateId == null) {
          this.docStore.apply([{ op: "AddState", label: nextStateLabel(this.docStore.getStates()), x, y }]);
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
          this.docStore.apply([{ op: "SetTransitions", from, to, entries: [] }]);
        }
        break;
      case "create-transition":
        if (stateId != null) this._lastEditPromise = this._handleCreateTransitionClick(stateId);
        break;
      default:
        break;
    }
  }

  _onCanvasMouseDown(event) {
    const stateId = event.target?.dataset?.stateId ? Number(event.target.dataset.stateId) : null;
    if (this.ctx.activeTool === "select" && stateId != null) {
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
      return;
    }
    if (event.target === this.svg && this.ctx.activeTool !== "create-state") {
      this._panState = { startClientX: event.clientX, startClientY: event.clientY, startView: { ...this._view } };
      this.svg.classList.add("panning");
    }
  }

  _onCanvasMouseMove(event) {
    if (this._dragState) {
      const drag = this._dragState;
      const scale = this._svgScale();
      const x = drag.startX + (event.clientX - drag.startClientX) * scale.x;
      const y = drag.startY + (event.clientY - drag.startClientY) * scale.y;
      drag.x = x;
      drag.y = y;
      const state = this.docStore.getState(drag.id);
      if (state) {
        state.x = x;
        state.y = y;
        this._render();
      }
      return;
    }
    if (this._panState) {
      const pan = this._panState;
      const scale = this._svgScale();
      const dx = (event.clientX - pan.startClientX) * scale.x;
      const dy = (event.clientY - pan.startClientY) * scale.y;
      this._setViewBox(pan.startView.x - dx, pan.startView.y - dy, pan.startView.w, pan.startView.h);
    }
  }

  _onCanvasMouseUp() {
    const drag = this._dragState;
    this._dragState = null;
    this._panState = null;
    this.svg.classList.remove("panning");
    if (!drag) return;
    if (drag.x === drag.startX && drag.y === drag.startY) return;
    this.docStore.apply([{ op: "MoveState", id: drag.id, x: drag.x, y: drag.y }]);
  }

  _cancelDrag() {
    this._dragState = null;
    this._panState = null;
    this.svg.classList.remove("panning");
  }

  /** Marks the current selection's state as initial — the toolbar's
   * equivalent of `DiagramView`'s context-menu-only `state.markInitial`
   * (no registry/context-menu here yet, see this file's header comment). */
  markInitial() {
    if (this.ctx.selection?.kind !== "state") return;
    this.docStore.apply([{ op: "SetInitial", id: this.ctx.selection.id }]);
  }

  /** @returns {Promise<void>} — exposed via `this._lastEditPromise` so
   * tests can await the prompt + apply round trip deterministically, same
   * convention as `DiagramView`'s. */
  async _handleCreateTransitionClick(stateId) {
    if (this._pendingFrom == null) {
      this._pendingFrom = stateId;
      this._render();
      return;
    }
    const from = this._pendingFrom;
    this._pendingFrom = null;
    const existing = this.docStore.getEdge(from, stateId);
    const text = await this.ctx.promptTransition(existing ? formatTransitionEntries(existing.transitions) : "");
    const parsed = parseTransitionPrompt(text);
    if (!parsed) return;
    const entries = mergeTransitionEntry(existing?.transitions ?? [], parsed.input, parsed.output);
    await this.docStore.apply([{ op: "SetTransitions", from, to: stateId, entries }]);
  }

  _render() {
    if (this.ctx.activeTool !== "create-transition") this._pendingFrom = null;
    this._renderCanvas();
    this._renderInspector();
    this._renderStatusBar();
    this._renderCanvasInfoBar();
    this.svg.classList.toggle("tool-create-state", this.ctx.activeTool === "create-state");
    this.svg.classList.toggle("awaiting-edge-target", this._pendingFrom != null);
  }

  _renderCanvas() {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    this.svg.appendChild(this._defs);

    const states = this.docStore.getStates();
    const positions = new Map(states.map((s) => [s.id, { x: s.x, y: s.y }]));
    const edges = this.docStore.getEdges();

    const neighborsOf = new Map();
    const addNeighbor = (a, b) => {
      if (a === b) return;
      if (!neighborsOf.has(a)) neighborsOf.set(a, new Set());
      neighborsOf.get(a).add(b);
    };
    for (const edge of edges) {
      addNeighbor(edge.from, edge.to);
      addNeighbor(edge.to, edge.from);
    }

    const hasReverse = (edge) => edges.some((e) => e.from === edge.to && e.to === edge.from);

    for (const edge of edges) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;

      let d = null;
      let labelX;
      let labelY;
      let isSelfLoop = false;

      if (edge.from === edge.to) {
        isSelfLoop = true;
        const neighborPositions = [...(neighborsOf.get(edge.from) ?? [])].map((id) => positions.get(id)).filter(Boolean);
        const angleDeg = preferredLoopAngle(from, neighborPositions);
        ({ d, labelX, labelY } = selfLoopPath(from, STATE_RADIUS, { angleDeg }));
      } else if (hasReverse(edge)) {
        const side = edge.from < edge.to ? 1 : -1;
        ({ d, labelX, labelY } = curvedEdgePath(from, to, STATE_RADIUS, side));
      }

      const tag = d ? "path" : "line";
      const el = document.createElementNS(SVG_NS, tag);
      el.dataset.edge = `${edge.from}:${edge.to}`;
      el.setAttribute("marker-end", "url(#mealy-arrow)");
      if (d) {
        el.setAttribute("d", d);
        el.setAttribute("fill", "none");
      } else {
        const geo = edgeEndpoints(from, to, STATE_RADIUS);
        el.setAttribute("x1", String(geo.x1));
        el.setAttribute("y1", String(geo.y1));
        el.setAttribute("x2", String(geo.x2));
        el.setAttribute("y2", String(geo.y2));
        const ddx = to.x - from.x;
        const ddy = to.y - from.y;
        const dist = Math.hypot(ddx, ddy) || 1;
        labelX = (from.x + to.x) / 2 + (-ddy / dist) * EDGE_LABEL_GAP;
        labelY = (from.y + to.y) / 2 + (ddx / dist) * EDGE_LABEL_GAP;
      }
      el.setAttribute("class", "edge");
      if (isSelfLoop) el.classList.add("self-loop");
      if (this._isSelectedEdge(edge)) el.classList.add("selected");

      const hit = document.createElementNS(SVG_NS, tag);
      hit.dataset.edge = el.dataset.edge;
      hit.setAttribute("class", "edge-hit");
      if (d) {
        hit.setAttribute("d", d);
      } else {
        for (const attr of ["x1", "y1", "x2", "y2"]) hit.setAttribute(attr, el.getAttribute(attr));
      }
      hit.addEventListener("mouseenter", () => el.classList.add("edge-hover"));
      hit.addEventListener("mouseleave", () => el.classList.remove("edge-hover"));

      const label = document.createElementNS(SVG_NS, "text");
      label.textContent = formatTransitionEntries(edge.transitions);
      label.setAttribute("x", String(labelX));
      label.setAttribute("y", String(labelY));
      label.setAttribute("class", "edge-label");
      this.svg.append(hit, el, label);
    }

    for (const state of states) {
      if (state.initial) {
        const arrow = document.createElementNS(SVG_NS, "line");
        arrow.setAttribute("x1", String(state.x - STATE_RADIUS - 22));
        arrow.setAttribute("y1", String(state.y));
        arrow.setAttribute("x2", String(state.x - STATE_RADIUS - 4));
        arrow.setAttribute("y2", String(state.y));
        arrow.setAttribute("marker-end", "url(#mealy-arrow)");
        arrow.setAttribute("class", "initial-arrow");
        this.svg.appendChild(arrow);
      }

      const circle = document.createElementNS(SVG_NS, "circle");
      circle.dataset.stateId = String(state.id);
      circle.setAttribute("cx", String(state.x));
      circle.setAttribute("cy", String(state.y));
      circle.setAttribute("r", String(STATE_RADIUS));
      circle.setAttribute("class", "state");
      if (state.initial) circle.classList.add("initial");
      if ((this.docStore.derived.unreachable ?? []).includes(state.id)) {
        circle.classList.add("unreachable");
      }
      if (this._isSelectedState(state.id)) circle.classList.add("selected");
      if (this._pendingFrom === state.id) circle.classList.add("pending-edge-source");
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

  async _renameState(id) {
    const label = await this.ctx.promptLabel(id);
    if (label) await this.ctx.renameState(id, label);
  }

  _isSelectedState(id) {
    return this.ctx.selection?.kind === "state" && this.ctx.selection.id === id;
  }

  _isSelectedEdge(edge) {
    return (
      this.ctx.selection?.kind === "edge" && this.ctx.selection.from === edge.from && this.ctx.selection.to === edge.to
    );
  }

  _renderInspector() {
    const sel = this.ctx.selection;
    if (!sel) {
      this.inspector.textContent = "Sin selección";
      return;
    }
    if (sel.kind === "state") {
      const state = this.docStore.getState(sel.id);
      if (!state) {
        this.inspector.textContent = "Sin selección";
        return;
      }
      this.inspector.textContent = `Estado ${state.label} (#${state.id})` + (state.initial ? " · inicial" : "");
    } else if (sel.kind === "edge") {
      const edge = this.docStore.getEdge(sel.from, sel.to);
      this.inspector.textContent = edge
        ? `Transición ${sel.from} -> ${sel.to}: ${formatTransitionEntries(edge.transitions)}`
        : "Sin selección";
    }
  }

  _renderStatusBar() {
    const states = this.docStore.getStates();
    const edges = this.docStore.getEdges();
    const transitionCount = edges.reduce((sum, e) => sum + e.transitions.length, 0);
    const derived = this.docStore.derived;
    this.statusBar.textContent =
      `Mealy · ${derived.deterministic ? "determinista" : "no determinista"} · Q=${states.length} · ` +
      `Σ=${derived.input_alphabet.length} · δ=${transitionCount}` +
      (derived.unreachable.length > 0 ? ` · ${derived.unreachable.length} inalcanzable(s)` : "");
  }

  _renderCanvasInfoBar() {
    const states = this.docStore.getStates();
    const noun = states.length === 1 ? "estado" : "estados";
    this.canvasStatusChip.textContent = `Mealy · ${states.length} ${noun}`;
    this.canvasFileLabel.textContent = this.docStore.filePath ? this.docStore.filePath.split(/[\\/]/).pop() : "";
  }
}
