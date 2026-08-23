// PDA (Pushdown Automaton) canvas — same core interaction model as
// `MooreDiagramView.js` (4-tool L0 pattern: select/create-state/create-
// transition/delete, click-drag, pan/zoom, keyboard dispatch, right-click
// context menu — all driven by `pdaRegistry.js`, design D6's "nothing
// bypasses the registry" rule). Reuses `views/diagram/geometry.js`'s pure
// curve/layout math directly, same as Mealy/Moore's views.
//
// Differences from `MooreDiagramView.js`, all traceable to `PdaDoc` itself:
//  - Accepting-state double circle (`.state-accepting-ring`) — reused
//    verbatim from `views/diagram/DiagramView.js`'s FA rendering, since PDA
//    has accepting states and Moore/Mealy don't.
//  - Transitions are a FLAT list keyed by `id`, not one payload per
//    `(from,to)` edge — several transitions can share the same endpoints
//    with different `(input,pop,push)`. Selection is `{kind:'transition',
//    id}`, not `{kind:'edge', from, to}`.
//  - **Multiple-transitions-between-the-same-pair rendering — the one
//    genuinely new challenge FA/Mealy/Moore never had.** Real JFLAP
//    (verified this session by decompiling `gui/viewer/AutomatonDrawer.class`/
//    `InvisibleCurvedArrow.class` with `cfr`) draws exactly ONE real visible
//    arc per `(from,to)` pair; every additional transition sharing that pair
//    gets an `InvisibleCurvedArrow` — same curve math at an increasing
//    curvature, but only its label is ever drawn, never the line/arrowhead.
//    Deliberate deviation here: every transition gets its OWN full, real,
//    independently-clickable curved arc (`curvedEdgePath` with an `offset`
//    that increases per index within its `(from,to)` group) — JFLAP's "one
//    real arc + floating orphan labels" reads as confusing/incomplete in a
//    from-scratch clone. Self-loops fan out the same way via `selfLoopPath`,
//    incrementing `angleDeg` per index in the state's self-loop group.
//  - Creating/editing a transition prompts three times in sequence (input,
//    pop, push — `promptTransitionTriple` from `pdaRegistry.js`), not once
//    for a single symbol.
//  - "Abrir"/"Guardar" live here for the same reason as Mealy/Moore's — no
//    menu bar of PDA's own (see docs/decisions.md).

import { curvedEdgePath, nextStateLabel, preferredLoopAngle, selfLoopPath } from "../diagram/geometry.js";
import { findPdaAction, findPdaActionByKeybinding, keybindingOf, promptTransitionTriple } from "../../commands/pdaRegistry.js";
import { formatTransitionLabel } from "./pdaLogic.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const STATE_RADIUS = 20;
const BASE_WIDTH = 600;
const BASE_HEIGHT = 400;
const BASE_ARC_OFFSET = 36;
const ARC_OFFSET_STEP = 26;
const SELF_LOOP_ANGLE_STEP = 40;

export class PdaDiagramView {
  /**
   * @param {HTMLElement} container
   * @param {import('../../store/PdaDocStore.js').PdaDocStore} docStore
   * @param {import('../../commands/PdaContext.js').PdaContext} ctx
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
    this.root.className = "diagram-view pda-diagram-view";

    this.canvasInfoBar = document.createElement("div");
    this.canvasInfoBar.className = "canvas-toolbar";
    this.canvasFileLabel = document.createElement("span");

    // No menu bar of PDA's own yet (see docs/decisions.md) — Abrir/Guardar
    // live here instead, next to the status chip, native-JSON only (no
    // `.jff` for PDA), same as Mealy/Moore's views.
    this.openFileButton = document.createElement("button");
    this.openFileButton.type = "button";
    this.openFileButton.className = "canvas-file-btn";
    this.openFileButton.textContent = "Abrir";
    this.openFileButton.addEventListener("click", () => {
      this._lastFilePromise = this.ctx.openFile();
    });

    this.saveFileButton = document.createElement("button");
    this.saveFileButton.type = "button";
    this.saveFileButton.className = "canvas-file-btn";
    this.saveFileButton.textContent = "Guardar";
    this.saveFileButton.addEventListener("click", () => {
      this._lastFilePromise = this.ctx.saveFile();
    });

    this.canvasStatusChip = document.createElement("span");
    this.canvasStatusChip.className = "chip";

    const canvasInfoBarRight = document.createElement("div");
    canvasInfoBarRight.className = "canvas-toolbar-right";
    canvasInfoBarRight.append(this.openFileButton, this.saveFileButton, this.canvasStatusChip);

    this.canvasInfoBar.append(this.canvasFileLabel, canvasInfoBarRight);

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
    this.svg.addEventListener("wheel", (e) => this._onWheel(e), { passive: false });

    const defs = document.createElementNS(SVG_NS, "defs");
    const marker = document.createElementNS(SVG_NS, "marker");
    marker.setAttribute("id", "pda-arrow");
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

  /** Single input-dispatch path — mirrors `MooreDiagramView._dispatchKey`. */
  _dispatchKey(event) {
    const action = findPdaActionByKeybinding(keybindingOf(event));
    if (action && action.when(this.ctx)) action.run(this.ctx);
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
    const transitionId = target?.dataset?.transitionId ? Number(target.dataset.transitionId) : null;

    switch (this.ctx.activeTool) {
      case "create-state":
        if (stateId == null) {
          this.docStore.apply([{ op: "AddState", label: nextStateLabel(this.docStore.getStates()), x, y }]);
        }
        break;
      case "select":
        if (stateId != null) {
          this.ctx.setSelection({ kind: "state", id: stateId });
        } else if (transitionId != null) {
          this.ctx.setSelection({ kind: "transition", id: transitionId });
        } else {
          this.ctx.clearSelection();
        }
        break;
      case "delete":
        if (stateId != null) {
          this.docStore.apply([{ op: "RemoveState", id: stateId }]);
        } else if (transitionId != null) {
          this.docStore.apply([{ op: "RemoveTransition", id: transitionId }]);
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

  /** Right-click on a state or a transition arc: select it, suppress the
   * native browser menu, show the applicable registry actions — mirrors
   * `MooreDiagramView._onCanvasContextMenu`, split into two branches since
   * PDA has two independently-selectable kinds (Moore only has states and
   * edges are always the delete-only-what-you-drew shape). */
  _onCanvasContextMenu(event) {
    const stateId = event.target?.dataset?.stateId ? Number(event.target.dataset.stateId) : null;
    const transitionId = event.target?.dataset?.transitionId ? Number(event.target.dataset.transitionId) : null;
    if (stateId != null) {
      event.preventDefault();
      this.ctx.setSelection({ kind: "state", id: stateId });
      this._showContextMenu(event.clientX, event.clientY, [
        "state.rename",
        "state.markInitial",
        "state.toggleAccepting",
        "edit.deleteSelection",
      ]);
    } else if (transitionId != null) {
      event.preventDefault();
      this.ctx.setSelection({ kind: "transition", id: transitionId });
      this._showContextMenu(event.clientX, event.clientY, ["transition.edit", "edit.deleteSelection"]);
    }
  }

  _showContextMenu(x, y, actionIds) {
    this._closeContextMenu();

    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    for (const id of actionIds) {
      const action = findPdaAction(id);
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

  /** @returns {Promise<void>} — exposed via `this._lastEditPromise` so tests
   * can await the prompt + apply round trip deterministically, same
   * convention as `MooreDiagramView`'s. Runs the three-field prompt
   * (`promptTransitionTriple`, `pdaRegistry.js`) once both endpoints are
   * picked; cancelling any of the three aborts with no op applied. */
  async _handleCreateTransitionClick(stateId) {
    if (this._pendingFrom == null) {
      this._pendingFrom = stateId;
      this._render();
      return;
    }
    const from = this._pendingFrom;
    this._pendingFrom = null;
    const result = await promptTransitionTriple(this.ctx);
    if (!result) return;
    await this.docStore.apply([{ op: "AddTransition", from, to: stateId, ...result }]);
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
    const transitions = this.docStore.getTransitions();

    // Group transitions purely for the fan-out-offset rendering below — the
    // data model itself stays flat (`PdaTransitionView`s keyed by id), this
    // grouping never touches the store.
    const pairGroups = new Map();
    const selfGroups = new Map();
    for (const t of transitions) {
      if (t.from === t.to) {
        if (!selfGroups.has(t.from)) selfGroups.set(t.from, []);
        selfGroups.get(t.from).push(t);
      } else {
        const key = `${t.from}:${t.to}`;
        if (!pairGroups.has(key)) pairGroups.set(key, []);
        pairGroups.get(key).push(t);
      }
    }

    const neighborsOf = new Map();
    const addNeighbor = (a, b) => {
      if (a === b) return;
      if (!neighborsOf.has(a)) neighborsOf.set(a, new Set());
      neighborsOf.get(a).add(b);
    };
    for (const t of transitions) {
      addNeighbor(t.from, t.to);
      addNeighbor(t.to, t.from);
    }

    for (const [key, group] of pairGroups) {
      const [fromId, toId] = key.split(":").map(Number);
      const from = positions.get(fromId);
      const to = positions.get(toId);
      if (!from || !to) continue;
      // A reverse group (`to -> from`) bulges the opposite way — every
      // transition within THIS group still shares the same `side`, only the
      // per-index `offset` grows, so a `(from,to)` group and its reverse
      // `(to,from)` group never overlap each other.
      const side = pairGroups.has(`${toId}:${fromId}`) ? (fromId < toId ? 1 : -1) : 1;
      group.forEach((t, index) => {
        const offset = BASE_ARC_OFFSET + index * ARC_OFFSET_STEP;
        const { d, labelX, labelY } = curvedEdgePath(from, to, STATE_RADIUS, side, offset);
        this._renderTransitionArc(t, d, labelX, labelY, false);
      });
    }

    for (const [stateId, group] of selfGroups) {
      const from = positions.get(stateId);
      if (!from) continue;
      const neighborPositions = [...(neighborsOf.get(stateId) ?? [])].map((id) => positions.get(id)).filter(Boolean);
      const baseAngle = preferredLoopAngle(from, neighborPositions);
      group.forEach((t, index) => {
        const angleDeg = baseAngle + index * SELF_LOOP_ANGLE_STEP;
        const { d, labelX, labelY } = selfLoopPath(from, STATE_RADIUS, { angleDeg });
        this._renderTransitionArc(t, d, labelX, labelY, true);
      });
    }

    for (const state of states) {
      if (state.initial) {
        const arrow = document.createElementNS(SVG_NS, "line");
        arrow.setAttribute("x1", String(state.x - STATE_RADIUS - 22));
        arrow.setAttribute("y1", String(state.y));
        arrow.setAttribute("x2", String(state.x - STATE_RADIUS - 4));
        arrow.setAttribute("y2", String(state.y));
        arrow.setAttribute("marker-end", "url(#pda-arrow)");
        arrow.setAttribute("class", "initial-arrow");
        this.svg.appendChild(arrow);
      }

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

      // Classic automata-theory "double circle" for an accepting/final
      // state — reused verbatim from `views/diagram/DiagramView.js`'s FA
      // rendering, `pointer-events: none` so it never steals hover/click
      // from the real state circle underneath it.
      if (state.accepting) {
        const ring = document.createElementNS(SVG_NS, "circle");
        ring.setAttribute("cx", String(state.x));
        ring.setAttribute("cy", String(state.y));
        ring.setAttribute("r", String(STATE_RADIUS - 4));
        ring.setAttribute("class", "state-accepting-ring");
        this.svg.appendChild(ring);
      }
    }
  }

  /** One transition arc: a real, independently-clickable visible curve +
   * arrowhead + label, plus a wider invisible hit-path for easier clicking
   * (same "hit path" convention as `MooreDiagramView`'s edges). Double-click
   * opens `transition.edit`. */
  _renderTransitionArc(t, d, labelX, labelY, isSelfLoop) {
    const el = document.createElementNS(SVG_NS, "path");
    el.dataset.transitionId = String(t.id);
    el.setAttribute("marker-end", "url(#pda-arrow)");
    el.setAttribute("d", d);
    el.setAttribute("fill", "none");
    el.setAttribute("class", "edge");
    if (isSelfLoop) el.classList.add("self-loop");
    if (this._isSelectedTransition(t.id)) el.classList.add("selected");

    const hit = document.createElementNS(SVG_NS, "path");
    hit.dataset.transitionId = String(t.id);
    hit.setAttribute("class", "edge-hit");
    hit.setAttribute("d", d);
    hit.addEventListener("mouseenter", () => el.classList.add("edge-hover"));
    hit.addEventListener("mouseleave", () => el.classList.remove("edge-hover"));
    hit.addEventListener("dblclick", () => {
      this.ctx.setSelection({ kind: "transition", id: t.id });
      this._lastEditPromise = findPdaAction("transition.edit").run(this.ctx);
    });

    const label = document.createElementNS(SVG_NS, "text");
    label.textContent = formatTransitionLabel(t.input, t.pop, t.push);
    label.setAttribute("x", String(labelX));
    label.setAttribute("y", String(labelY));
    label.setAttribute("class", "edge-label");

    this.svg.append(hit, el, label);
  }

  async _renameState(id) {
    const label = await this.ctx.promptLabel(id);
    if (label) await this.ctx.renameState(id, label);
  }

  _isSelectedState(id) {
    return this.ctx.selection?.kind === "state" && this.ctx.selection.id === id;
  }

  _isSelectedTransition(id) {
    return this.ctx.selection?.kind === "transition" && this.ctx.selection.id === id;
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
      this.inspector.textContent =
        `Estado ${state.label} (#${state.id})` + (state.initial ? " · inicial" : "") + (state.accepting ? " · aceptación" : "");
    } else if (sel.kind === "transition") {
      const t = this.docStore.getTransition(sel.id);
      this.inspector.textContent = t ? `Transición ${t.from} -> ${t.to}: ${formatTransitionLabel(t.input, t.pop, t.push)}` : "Sin selección";
    }
  }

  _renderStatusBar() {
    const states = this.docStore.getStates();
    const transitions = this.docStore.getTransitions();
    const derived = this.docStore.derived;
    this.statusBar.textContent =
      `PDA · ${derived.deterministic ? "determinista" : "no determinista"} · Q=${states.length} · ` +
      `Σ=${derived.input_alphabet.length} · Γ=${derived.stack_alphabet.length} · δ=${transitions.length}` +
      (derived.unreachable.length > 0 ? ` · ${derived.unreachable.length} inalcanzable(s)` : "");
  }

  _renderCanvasInfoBar() {
    const states = this.docStore.getStates();
    const noun = states.length === 1 ? "estado" : "estados";
    this.canvasStatusChip.textContent = `PDA · ${states.length} ${noun}`;
    this.canvasFileLabel.textContent = this.docStore.filePath ? this.docStore.filePath.split(/[\\/]/).pop() : "";
  }
}
