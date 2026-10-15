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

import { findAction, findByKeybinding, keybindingOf } from "../../commands/registry.js";
import {
  circleLayout,
  curvedEdgePath,
  edgeEndpoints,
  estimateLabelSize,
  nextStateLabel,
  preferredLoopAngle,
  resolveLabelOverlaps,
  selfLoopPath,
  statusSummary,
} from "./geometry.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const STATE_RADIUS = 20;
const BASE_WIDTH = 600;
const BASE_HEIGHT = 400;
/** How far a transition's label sits off the line/curve — `0`, i.e. the
 * label sits right on the curve's own true midpoint, not pushed to either
 * side. Before `edge-label-bg` existed, a `0` gap read as a bug (the line
 * visibly crossed straight through the glyph — see `curvedEdgePath`/
 * `selfLoopPath`'s own tests in geometry.test.js, still named after that
 * bug), which is why a nonzero push existed at all. The halo now paints the
 * line invisible under the text regardless of exact alignment, so that
 * failure mode is gone — and a nonzero push turned out to trade it for a
 * DIFFERENT one: pushed sideways, a label's halo can reach far enough to
 * clip a *different*, nearby edge's line instead of its own (found live:
 * a routed edge's tight lane a few px from another label). Sitting exactly
 * on its own line/curve means whatever the halo covers is always that same
 * label's own line — never a neighbor's. */
const EDGE_LABEL_GAP = 0;
/** Hard cap (`resolveLabelOverlaps`'s `maxDrift`) on how far a full-render
 * label pass may nudge a label away from its own edge to clear another
 * label — big enough to separate two typical short symbol-list labels, not
 * so big a label drifts into a neighboring routing lane or stops reading as
 * belonging to its own edge. Only used on a full `_renderCanvas` pass (see
 * that method) — never during `_patchDragPosition`'s per-mousemove patch,
 * which would reintroduce the whole-diagram-recompute cost that patch
 * exists to avoid. */
const LABEL_MAX_DRIFT = 18;

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

  /** Mouse-wheel zoom, centered on the cursor (not the canvas center) so
   * zooming in on one corner of a large automaton doesn't recenter the view
   * out from under the cursor — the free-navigation request this satisfies
   * ("agrandar/achicar la vista... moverse hacia cualquier lado"). */
  _onWheel(event) {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1.1 : 1 / 1.1;
    const cursor = this._svgPoint(event.clientX, event.clientY);
    const { x, y, w, h } = this._view;
    const nw = w * factor;
    const nh = h * factor;
    // Keep the point under the cursor at the same relative position inside
    // the new viewBox, instead of scaling around the viewBox's own center.
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
    let w = Math.max(maxX - minX, 1);
    let h = Math.max(maxY - minY, 1);
    const cx = minX + w / 2;
    const cy = minY + h / 2;

    // Grow the tight content bbox to the pane's own aspect ratio before
    // setting the viewBox — a mismatch (routine after the layered
    // "Organizar" layout, which is wide and short) gets letterboxed by the
    // SVG's default `preserveAspectRatio` (xMidYMid meet): empty margins on
    // whichever axis is "too short". `_svgScale()`/`_svgPoint()` divide by
    // the FULL element rect, not that letterboxed visible sub-rect, so the
    // margined axis ends up under-scaled there — found live as "dragging a
    // state feels sluggish vertically, perfect horizontally" right after
    // Organizar. Padding here removes the letterbox (and the scale
    // mismatch with it) instead of patching the drag math to compensate for
    // it. Skipped when the element has no real layout yet (jsdom in tests,
    // same zero-rect case `_svgScale()` already falls back on) — nothing to
    // match against, so the tight bbox stands.
    const rect = this.svg.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const targetAspect = rect.width / rect.height;
      const contentAspect = w / h;
      if (contentAspect > targetAspect) {
        h = w / targetAspect;
      } else if (contentAspect < targetAspect) {
        w = h * targetAspect;
      }
    }
    this._setViewBox(cx - w / 2, cy - h / 2, w, h);
  }

  _buildStaticDom() {
    this.root = document.createElement("div");
    this.root.className = "diagram-view";

    // Filename (left) / classification chip (right) — matches the
    // wireframe's `.canvas-toolbar` (an unfortunate name clash with the
    // app-level `.toolbar`; kept as-is since it's the artifact's literal
    // class name).
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
    this.svg.addEventListener("keydown", (e) => this._dispatchKey(e));
    this.svg.addEventListener("mousedown", (e) => this._onCanvasMouseDown(e));
    this.svg.addEventListener("mousemove", (e) => this._onCanvasMouseMove(e));
    this.svg.addEventListener("mouseup", (e) => this._onCanvasMouseUp(e));
    this.svg.addEventListener("mouseleave", () => this._cancelDrag());
    this.svg.addEventListener("contextmenu", (e) => this._onCanvasContextMenu(e));
    this.svg.addEventListener("wheel", (e) => this._onWheel(e), { passive: false });

    const defs = document.createElementNS(SVG_NS, "defs");
    const marker = document.createElementNS(SVG_NS, "marker");
    marker.setAttribute("id", "arrow");
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
    this._defs = defs; // re-appended on every render — `_renderCanvas` wipes all svg children first
    this.svg.appendChild(defs);

    this.inspector = document.createElement("div");
    this.inspector.className = "selection-inspector";

    this.statusBar = document.createElement("div");
    this.statusBar.className = "status-bar";

    this.root.append(this.canvasInfoBar, this.svg, this.inspector, this.statusBar);
    this.container.appendChild(this.root);
  }

  /** Single input-dispatch path: normalize the key, look it up in the
   * registry, and run whatever action (if any) claims it. No behavior is
   * ever wired directly to a raw key here. */
  _dispatchKey(event) {
    const action = findByKeybinding(keybindingOf(event));
    if (action && action.when(this.ctx)) action.run(this.ctx);
  }

  /** Client (screen-pixel) -> SVG *scale factor*, for turning a mouse delta
   * or coordinate into diagram units. `.diagram-canvas` stretches to fill
   * its flex container (`width: 100%`), so its rendered pixel size almost
   * never matches the `viewBox` (600x400, or smaller/larger after zoom) —
   * 1 screen pixel is not 1 SVG unit. Without this, created states landed
   * away from the actual click point, and drags drifted from the cursor as
   * they moved (found by actually creating/dragging states in the app).
   * Falls back to a 1:1 ratio when the element has no real layout (jsdom in
   * tests never performs layout, so `getBoundingClientRect` is all zeros
   * there — the existing click/drag tests assert on exact pixel-for-unit
   * values that this fallback preserves). */
  _svgScale() {
    const rect = this.svg.getBoundingClientRect();
    return {
      x: rect.width > 0 ? this._view.w / rect.width : 1,
      y: rect.height > 0 ? this._view.h / rect.height : 1,
    };
  }

  /** Client (screen) coordinates -> SVG user-space coordinates, accounting
   * for both the render-size scale above and the current pan/zoom offset
   * (`this._view.x/y`). */
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
   * on release and re-selects the same state; that is harmless. A
   * mousedown that lands on empty canvas instead starts panning the
   * viewport (free navigation) — except while create-state is active,
   * since that tool creates a state on every empty-canvas click and
   * "click to place a state" would otherwise fight over the same drag
   * gesture. */
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
      this._panState = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        startView: { ...this._view },
      };
      this.svg.classList.add("panning");
    }
  }

  /** Local optimistic geometry update during the drag — mutates the
   * `DocStore` mirror directly and re-renders, without round-tripping to
   * the server on every mousemove (design D3: "drag preview is
   * frontend-local"). The authoritative `MoveState` op is only sent once,
   * on release (`_onCanvasMouseUp`). Panning (`_panState`) instead updates
   * the viewBox directly — there's nothing to commit to the document. */
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
        // Not `_render()` — that tears down and rebuilds every state/edge in
        // the whole diagram on every single mousemove, which visibly lags on
        // anything but a tiny automaton. Patch just the dragged state and
        // whatever edges touch it instead; everything else keeps its
        // existing DOM nodes untouched.
        this._patchDragPosition(drag.id);
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

  /** Commit the drag as a single undoable `MoveState` transaction (design
   * D3: "one `MoveStates` op committed on pointerup — also the undo
   * granularity"). A drag that never moved is a no-op: no history entry,
   * no round trip. Panning never round-trips to the document at all. */
  _onCanvasMouseUp() {
    const drag = this._dragState;
    this._dragState = null;
    this._panState = null;
    this.svg.classList.remove("panning");
    if (!drag) return;
    if (drag.x === drag.startX && drag.y === drag.startY) return;
    this.docStore.apply([{ op: "MoveState", id: drag.id, x: drag.x, y: drag.y }]);
  }

  /** Abort an in-progress drag/pan without committing (e.g. the pointer
   * leaves the canvas). The local optimistic geometry (or viewBox) stays
   * wherever it was last moved to — same as releasing outside the canvas
   * would in most editors — but no server round trip happens for a
   * cancelled drag. */
  _cancelDrag() {
    this._dragState = null;
    this._panState = null;
    this.svg.classList.remove("panning");
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
      // No docStore/ctx mutation happens for just picking a source, so
      // nothing else triggers a re-render — do it explicitly to show the
      // .pending-edge-source / .awaiting-edge-target hover cues right away.
      this._render();
      return;
    }
    const from = this._pendingFrom;
    this._pendingFrom = null;
    const symbol = await this.ctx.promptSymbol();
    // null = the prompt was cancelled, do nothing. "" = the field was left
    // blank on purpose, meaning "make this an epsilon transition" (the
    // prompt's own "blank = epsilon" label) — distinct from cancelling, so
    // it must NOT be folded into the same early return as null.
    if (symbol == null) return;
    const existing = this.docStore.getEdge(from, stateId);
    const isEpsilon = symbol === "";
    const symbols = isEpsilon
      ? (existing?.symbols ?? [])
      : existing
        ? [...new Set([...existing.symbols, symbol])]
        : [symbol];
    await this.docStore.apply([
      { op: "SetEdge", from, to: stateId, epsilon: isEpsilon || (existing?.epsilon ?? false), symbols },
    ]);
  }

  _render() {
    // A pending transition source only makes sense while create-transition
    // is the active tool — switching tools mid-pick (e.g. to select/delete)
    // must not leave a stale source highlighted on the next visit back.
    if (this.ctx.activeTool !== "create-transition") this._pendingFrom = null;
    this._renderCanvas();
    this._renderInspector();
    this._renderStatusBar();
    this._renderCanvasInfoBar();
    // Crosshair cursor while create-state is active (panning is disabled for
    // that tool, so a grab cursor would be misleading) — see .diagram-canvas
    // / .tool-create-state in style.css.
    this.svg.classList.toggle("tool-create-state", this.ctx.activeTool === "create-state");
    // Once a transition source is picked, every hovered state becomes a
    // candidate target (including the source itself, for a self-loop) —
    // .awaiting-edge-target drives that hover cue in style.css.
    this.svg.classList.toggle("awaiting-edge-target", this._pendingFrom != null);
  }

  /**
   * Geometry for one edge — shared by `_renderCanvas` (building a new `<path>`/
   * `<line>`) and `_patchDragPosition` (updating an existing one's attributes
   * during a drag) so the two never drift apart into two slightly different
   * ideas of where an edge goes.
   * @param {{from:number, to:number}} edge
   * @param {Map<number, {x:number,y:number}>} positions
   * @param {Map<number, Set<number>>} neighborsOf
   * @param {(edge:{from:number,to:number}) => boolean} hasReverse
   */
  _computeEdgeGeometry(edge, positions, neighborsOf, hasReverse) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return null;

    let d = null;
    let labelX;
    let labelY;
    const isSelfLoop = edge.from === edge.to;

    if (isSelfLoop) {
      const neighborPositions = [...(neighborsOf.get(edge.from) ?? [])]
        .map((id) => positions.get(id))
        .filter(Boolean);
      const angleDeg = preferredLoopAngle(from, neighborPositions);
      ({ d, labelX, labelY } = selfLoopPath(from, STATE_RADIUS, { angleDeg, labelGap: EDGE_LABEL_GAP }));
    } else if (hasReverse(edge)) {
      const side = edge.from < edge.to ? 1 : -1;
      ({ d, labelX, labelY } = curvedEdgePath(from, to, STATE_RADIUS, side, undefined, EDGE_LABEL_GAP));
    }

    let x1, y1, x2, y2;
    if (!d) {
      const geo = edgeEndpoints(from, to, STATE_RADIUS);
      x1 = geo.x1;
      y1 = geo.y1;
      x2 = geo.x2;
      y2 = geo.y2;
      // Offset perpendicular to the line, not just a flat -4 in y — a flat
      // offset only reads as "beside the line" when the line happens to be
      // roughly horizontal; on any other angle the label still sits right
      // on top of the stroke.
      const ddx = to.x - from.x;
      const ddy = to.y - from.y;
      const dist = Math.hypot(ddx, ddy) || 1;
      labelX = (from.x + to.x) / 2 + (-ddy / dist) * EDGE_LABEL_GAP;
      labelY = (from.y + to.y) / 2 + (ddx / dist) * EDGE_LABEL_GAP;
    }
    return { d, x1, y1, x2, y2, labelX, labelY, isSelfLoop };
  }

  _renderCanvas() {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    this.svg.appendChild(this._defs);

    const states = this.docStore.getStates();
    const positions = new Map(states.map((s) => [s.id, { x: s.x, y: s.y }]));
    const edges = this.docStore.getEdges();

    // Every other state each state has an edge to/from, for
    // `preferredLoopAngle` — a self-loop should point away from whatever
    // else is already attached to that state, not always straight up.
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

    // A->B and B->A both existing would otherwise draw the exact same
    // straight segment twice, arrowheads meeting in the middle and both
    // labels on top of each other — curve them apart instead, one to each
    // side, picked the same way regardless of which of the pair is being
    // drawn right now so they never pick the same side as each other.
    const hasReverse = (edge) => edges.some((e) => e.from === edge.to && e.to === edge.from);

    // Rebuilt from scratch every full render (this method already tears
    // down and recreates every element above) — `_patchDragPosition` reads
    // these to update an in-progress drag's affected elements in place,
    // without going through here again. `edgesByState` maps a state id to
    // every edge touching it (both ends of a self-loop count once), so a
    // drag can find exactly which edges need their geometry recomputed.
    this._stateEls = new Map();
    this._edgeEls = new Map();
    this._edgesByState = new Map(states.map((s) => [s.id, []]));
    this._geometryCtx = { positions, neighborsOf, hasReverse };

    // Phase 1: every edge's raw geometry + its label's estimated size,
    // before touching the DOM at all — `resolveLabelOverlaps` (phase 2)
    // needs the COMPLETE set of labels at once, since the whole point is
    // comparing one edge's label against every other edge's, which none of
    // `_computeEdgeGeometry`'s per-edge math ever does on its own.
    const edgeRenders = [];
    for (const edge of edges) {
      const geo = this._computeEdgeGeometry(edge, positions, neighborsOf, hasReverse);
      if (!geo) continue;
      const text = edge.epsilon ? ["ε", ...edge.symbols].join(",") : edge.symbols.join(",");
      const { width, height } = estimateLabelSize(text);
      edgeRenders.push({ edge, geo, text, width, height });
    }

    // Phase 2: resolve every label's position against the complete set in
    // one pass (see `resolveLabelOverlaps`'s own doc comment for why this
    // can't happen per-edge). `maxDrift` keeps a resolved label from ever
    // drifting far enough to stop reading as belonging to its own edge.
    const resolvedLabels = resolveLabelOverlaps(
      edgeRenders.map(({ edge, geo, width, height }) => ({
        key: `${edge.from}:${edge.to}`,
        x: geo.labelX,
        y: geo.labelY,
        width,
        height,
      })),
      { maxDrift: LABEL_MAX_DRIFT },
    );
    const resolvedLabelByKey = new Map(resolvedLabels.map((l) => [l.key, l]));

    // Phase 3: build the DOM using the resolved label positions.
    for (const { edge, geo, text, width, height } of edgeRenders) {
      const { d, x1, y1, x2, y2, isSelfLoop } = geo;
      const edgeKey = `${edge.from}:${edge.to}`;
      const resolvedLabel = resolvedLabelByKey.get(edgeKey);
      const labelX = resolvedLabel.x;
      const labelY = resolvedLabel.y;

      const tag = d ? "path" : "line";
      const el = document.createElementNS(SVG_NS, tag);
      el.dataset.edge = edgeKey;
      el.setAttribute("marker-end", "url(#arrow)");
      if (d) {
        el.setAttribute("d", d);
        el.setAttribute("fill", "none");
      } else {
        el.setAttribute("x1", String(x1));
        el.setAttribute("y1", String(y1));
        el.setAttribute("x2", String(x2));
        el.setAttribute("y2", String(y2));
      }
      el.setAttribute("class", "edge");
      if (isSelfLoop) el.classList.add("self-loop");
      if (this._isSelectedEdge(edge)) el.classList.add("selected");

      // Invisible, much wider duplicate of the same geometry — the actual
      // hover/click target. A 1.5px stroke is too thin to reliably hover or
      // click; this is the fix (also just makes edges easier to select in
      // general, not only a hover cue).
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

      // A background halo behind the label text, sized from the SAME
      // `estimateLabelSize` call that fed `resolveLabelOverlaps` above (not
      // recomputed independently — the halo and the collision math must
      // never disagree on how big a label is). Painted between the edge
      // line and the label text so it visually clears whatever line/label
      // sits behind it — an aesthetic fix independent of the overlap math,
      // since a label sitting right on top of a line/curve read poorly even
      // when nothing else overlapped it.
      const labelBg = document.createElementNS(SVG_NS, "rect");
      labelBg.setAttribute("x", String(labelX - width / 2));
      labelBg.setAttribute("y", String(labelY - height / 2));
      labelBg.setAttribute("width", String(width));
      labelBg.setAttribute("height", String(height));
      // Fully rounded ends (a "pill", not just softened corners) — reads as
      // a deliberate label chip sitting on the line rather than a stray
      // rectangle. `height / 2` rather than a fixed px radius so it stays
      // proportional if `estimateLabelSize`'s `lineHeight`/`paddingY` ever
      // change.
      labelBg.setAttribute("rx", String(height / 2));
      labelBg.setAttribute("ry", String(height / 2));
      labelBg.setAttribute("class", "edge-label-bg");

      const label = document.createElementNS(SVG_NS, "text");
      label.textContent = text;
      label.setAttribute("x", String(labelX));
      label.setAttribute("y", String(labelY));
      label.setAttribute("class", "edge-label");
      this.svg.append(hit, el, labelBg, label);

      this._edgeEls.set(edgeKey, { edge, el, hit, labelBg, label, labelWidth: width, labelHeight: height });
      this._edgesByState.get(edge.from)?.push(edgeKey);
      if (edge.to !== edge.from) this._edgesByState.get(edge.to)?.push(edgeKey);
    }

    for (const state of states) {
      const stateEls = {};

      // A short floating arrow pointing into the initial state from
      // outside, same convention as the wireframe artifact's demo SVG (a
      // fixed direction, not collision-avoided like self-loops — good
      // enough for a single arrow, and matches what was approved). Drawn
      // before the circle so it never competes with state hit-testing.
      if (state.initial) {
        const arrow = document.createElementNS(SVG_NS, "line");
        arrow.setAttribute("x1", String(state.x - STATE_RADIUS - 22));
        arrow.setAttribute("y1", String(state.y));
        arrow.setAttribute("x2", String(state.x - STATE_RADIUS - 4));
        arrow.setAttribute("y2", String(state.y));
        arrow.setAttribute("marker-end", "url(#arrow)");
        arrow.setAttribute("class", "initial-arrow");
        this.svg.appendChild(arrow);
        stateEls.initialArrow = arrow;
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
      stateEls.circle = circle;
      stateEls.label = label;

      // Classic automata-theory "double circle" for an accepting/final
      // state — a stroke-width difference alone (the previous approach)
      // read as too subtle to tell apart from a merely-selected state.
      // `pointer-events: none` (style.css) so it never steals hover/click
      // away from the real state circle underneath it.
      if (state.accepting) {
        const ring = document.createElementNS(SVG_NS, "circle");
        ring.setAttribute("cx", String(state.x));
        ring.setAttribute("cy", String(state.y));
        ring.setAttribute("r", String(STATE_RADIUS - 4));
        ring.setAttribute("class", "state-accepting-ring");
        this.svg.appendChild(ring);
        stateEls.ring = ring;
      }

      this._stateEls.set(state.id, stateEls);
    }
  }

  /**
   * Updates only the dragged state's own circle/label/arrow and whichever
   * edges touch it, in place — called on every mousemove of a drag instead
   * of `_render()`'s full teardown-and-rebuild (design: dragging visibly
   * lagged on anything but a tiny automaton, since a full rebuild recreates
   * every state and edge in the diagram on every single mousemove,
   * regardless of how many of them actually moved).
   *
   * Deliberately does NOT re-point another state's self-loop even if that
   * other state has an edge to/from the one being dragged — a self-loop's
   * angle depends on the *average direction* of all its neighbors
   * (`preferredLoopAngle`), so it can go briefly stale mid-drag. That's a
   * cosmetic-only gap, corrected the instant the drag commits (`MoveState`
   * on mouseup triggers the usual full `_render()` via `docStore.subscribe`)
   * — not worth widening this patch to chase for a transient-only case.
   * @param {number} stateId
   */
  _patchDragPosition(stateId) {
    const state = this.docStore.getState(stateId);
    const stateEls = this._stateEls?.get(stateId);
    if (!state || !stateEls) {
      // No lookup yet (e.g. a render path that skipped `_renderCanvas`) —
      // fall back to the always-correct full render rather than silently
      // doing nothing.
      this._render();
      return;
    }

    stateEls.circle.setAttribute("cx", String(state.x));
    stateEls.circle.setAttribute("cy", String(state.y));
    stateEls.label.setAttribute("x", String(state.x));
    stateEls.label.setAttribute("y", String(state.y));
    if (stateEls.ring) {
      stateEls.ring.setAttribute("cx", String(state.x));
      stateEls.ring.setAttribute("cy", String(state.y));
    }
    if (stateEls.initialArrow) {
      stateEls.initialArrow.setAttribute("x1", String(state.x - STATE_RADIUS - 22));
      stateEls.initialArrow.setAttribute("y1", String(state.y));
      stateEls.initialArrow.setAttribute("x2", String(state.x - STATE_RADIUS - 4));
      stateEls.initialArrow.setAttribute("y2", String(state.y));
    }

    // Refresh this one state's own entry in the shared positions map
    // (`_computeEdgeGeometry` reads from it) before recomputing its edges.
    this._geometryCtx.positions.set(stateId, { x: state.x, y: state.y });
    const { positions, neighborsOf, hasReverse } = this._geometryCtx;

    for (const edgeKey of this._edgesByState.get(stateId) ?? []) {
      const entry = this._edgeEls.get(edgeKey);
      if (!entry) continue;
      const geo = this._computeEdgeGeometry(entry.edge, positions, neighborsOf, hasReverse);
      if (!geo) continue;
      const { d, x1, y1, x2, y2, labelX, labelY } = geo;
      for (const el of [entry.el, entry.hit]) {
        if (d) {
          el.setAttribute("d", d);
        } else {
          el.setAttribute("x1", String(x1));
          el.setAttribute("y1", String(y1));
          el.setAttribute("x2", String(x2));
          el.setAttribute("y2", String(y2));
        }
      }
      entry.label.setAttribute("x", String(labelX));
      entry.label.setAttribute("y", String(labelY));
      // Not re-run through `resolveLabelOverlaps` here — only the edges
      // touching the dragged state are patched (see this method's own doc
      // comment on why), so there's no complete label set to resolve
      // against mid-drag; any transient overlap this causes is corrected by
      // the full `_render()` the drag's `MoveState` commit triggers on
      // release (`docStore.subscribe`, constructor).
      if (entry.labelBg) {
        entry.labelBg.setAttribute("x", String(labelX - entry.labelWidth / 2));
        entry.labelBg.setAttribute("y", String(labelY - entry.labelHeight / 2));
      }
    }
  }

  /** @returns {Promise<void>} — see `_handleCreateTransitionClick`'s doc
   * comment for the `_lastEditPromise` convention. */
  async _renameState(id) {
    const label = await this.ctx.promptLabel(id);
    // `ctx.renameState`, not a raw `docStore.apply` — a name collision must
    // surface a visible notice, not fail silently (task 7.9).
    if (label) await this.ctx.renameState(id, label);
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
        `Estado ${state.label} ` +
        `(#${state.id})` +
        (state.initial ? " · inicial" : "") +
        (state.accepting ? " · aceptación" : "");
    } else if (sel.kind === "edge") {
      const edge = this.docStore.getEdge(sel.from, sel.to);
      this.inspector.textContent = edge
        ? `Transición ${sel.from} -> ${sel.to}: ${edge.symbols.join(", ") || "ε"}`
        : "Sin selección";
    }
  }

  _renderStatusBar() {
    const summary = statusSummary({
      states: this.docStore.getStates(),
      edges: this.docStore.getEdges(),
      derived: this.docStore.derived,
    });
    const kind = summary.classification === "Dfa" ? "AFD" : "AFN";
    this.statusBar.textContent =
      `${kind} · Q=${summary.stateCount} · ` +
      `Σ=${summary.alphabetSize} · δ=${summary.transitionCount}` +
      (summary.unreachableCount > 0 ? ` · ${summary.unreachableCount} inalcanzable(s)` : "");
  }

  /** Compact "AFD · N estados" chip above the canvas (artifact parity) —
   * deliberately a lighter summary than `.status-bar`'s full Q/Σ/δ readout,
   * not a duplicate of it. */
  _renderCanvasInfoBar() {
    const summary = statusSummary({
      states: this.docStore.getStates(),
      edges: this.docStore.getEdges(),
      derived: this.docStore.derived,
    });
    const kind = summary.classification === "Dfa" ? "AFD" : "AFN";
    const noun = summary.stateCount === 1 ? "estado" : "estados";
    this.canvasStatusChip.textContent = `${kind} · ${summary.stateCount} ${noun}`;
    this.canvasFileLabel.textContent = this.docStore.filePath
      ? this.docStore.filePath.split(/[\\/]/).pop()
      : "";
  }
}
