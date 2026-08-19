// Pure (DOM-free) geometry and derived-stat helpers for the L0 diagram view
// (task 7.4). Kept separate from `DiagramView.js` so the SVG-rendering
// approach (design D6: SVG renderer, <=300 states) can be unit tested
// without a DOM at all, and so a future canvas-2D renderer (design D6's
// >300-state swap, explicitly out of scope for this PR) can reuse them
// unchanged.

/**
 * Smallest-unused-index `qN` label generator, matching kflap-v0.1's
 * ESTADOS naming convention (README: q0, q1, ...). Fills gaps left by
 * deletions rather than always appending, so re-creating states after a
 * delete does not run away to ever-larger numbers.
 * @param {{label:string}[]} states
 */
export function nextStateLabel(states) {
  const used = new Set();
  for (const s of states) {
    const m = /^q(\d+)$/.exec(s.label);
    if (m) used.add(Number(m[1]));
  }
  let n = 0;
  while (used.has(n)) n++;
  return `q${n}`;
}

/**
 * Evenly distribute states on a circle (kflap-v0.1's Cmd+L "circle layout").
 * @param {{id:number}[]} states
 * @param {{centerX:number, centerY:number, radius:number}} opts
 * @returns {{id:number, x:number, y:number}[]}
 */
export function circleLayout(states, { centerX, centerY, radius }) {
  const n = states.length;
  if (n === 0) return [];
  return states.map((s, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2; // start at the top
    return {
      id: s.id,
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    };
  });
}

/**
 * Trim a straight edge's endpoints to the boundary of each state's circle
 * (radius `r`), so arrowheads land on the circle edge rather than its
 * center. Returns a self-loop descriptor when `from === to` (same point).
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 * @param {number} r
 */
export function edgeEndpoints(from, to, r) {
  if (from.x === to.x && from.y === to.y) {
    return { selfLoop: true, x: from.x, y: from.y, r };
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  return {
    selfLoop: false,
    x1: from.x + ux * r,
    y1: from.y + uy * r,
    x2: to.x - ux * r,
    y2: to.y - uy * r,
  };
}

/**
 * Angle (degrees, SVG convention: 0=right, 90=down) pointing away from the
 * average direction of `neighborPositions` as seen from `state` — the
 * "least crowded" direction to hang a self-loop off of, so it doesn't grow
 * into whatever other edges the state already has. Defaults to straight up
 * (-90°) when the state has no neighbors at all.
 * @param {{x:number,y:number}} state
 * @param {{x:number,y:number}[]} neighborPositions other states this one has an edge to or from
 */
export function preferredLoopAngle(state, neighborPositions) {
  if (!neighborPositions.length) return -90;
  let sx = 0;
  let sy = 0;
  for (const n of neighborPositions) {
    const dx = n.x - state.x;
    const dy = n.y - state.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    sx += dx / dist;
    sy += dy / dist;
  }
  // Angle of the *negated* sum, so the result is already the direction
  // pointing away from the neighbors, normalized to atan2's own (-180,180]
  // range instead of needing a separate +180 wraparound step.
  return (Math.atan2(-sy, -sx) * 180) / Math.PI;
}

/**
 * A self-loop as an SVG cubic-bezier path, `d` string plus where to put its
 * label. Both endpoints sit on the circle boundary, and both control points
 * are pushed straight out along the *same radial line* as their endpoint —
 * so the curve leaves and re-enters the circle pointing at its center, not
 * off at a tangent (the "looks like it's aiming away from the automaton"
 * problem a flatter loop shape has). `labelX/labelY` is the curve's true
 * midpoint (`B(0.5)`, not a control point) pushed a further `labelGap` out
 * along the loop's own direction, so the label sits just outside the curve
 * instead of directly on top of it (`labelGap=0` would put it back on the
 * curve, e.g. for a caller that wants the old behavior).
 * @param {{x:number,y:number}} state
 * @param {number} r state circle radius
 * @param {{angleDeg?:number, spanDeg?:number, reach?:number, labelGap?:number}} [opts]
 *   `angleDeg`: direction the loop points (SVG convention, -90 = up).
 *   `spanDeg`: half the angle between the two boundary endpoints.
 *   `reach`: how far the control points are pushed out past the boundary —
 *   this is the loop's "length"; bigger reads as more oval/less stubby.
 *   `labelGap`: extra push (beyond the curve) for the label position.
 */
export function selfLoopPath(state, r, { angleDeg = -90, spanDeg = 25, reach = 40, labelGap = 12 } = {}) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const a0 = toRad(angleDeg - spanDeg);
  const a1 = toRad(angleDeg + spanDeg);
  const p0 = { x: state.x + r * Math.cos(a0), y: state.y + r * Math.sin(a0) };
  const p1 = { x: state.x + r * Math.cos(a1), y: state.y + r * Math.sin(a1) };
  const c0 = { x: p0.x + reach * Math.cos(a0), y: p0.y + reach * Math.sin(a0) };
  const c1 = { x: p1.x + reach * Math.cos(a1), y: p1.y + reach * Math.sin(a1) };
  const label = cubicMidpoint(p0, c0, c1, p1);
  const a = toRad(angleDeg);
  return {
    d: `M${p0.x},${p0.y} C${c0.x},${c0.y} ${c1.x},${c1.y} ${p1.x},${p1.y}`,
    labelX: label.x + labelGap * Math.cos(a),
    labelY: label.y + labelGap * Math.sin(a),
  };
}

/**
 * A curved edge between two *different* states, as a quadratic-bezier `d`
 * string plus its true midpoint for the label. Exists so a bidirectional
 * pair (an edge `A->B` and another `B->A`) can be drawn as two separated
 * arcs — one bulging each way via `side` (`1`/`-1`) — instead of the same
 * straight segment twice, which draws one arrowhead directly on top of the
 * other and both labels on top of each other. Endpoints are trimmed to the
 * circle boundary *along the direction to the control point*, not straight
 * toward the other center, so the curve meets the circle cleanly with no
 * gap or overlap.
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 * @param {number} r
 * @param {number} side `1` or `-1` — which way the arc bulges
 * @param {number} [offset] how far the control point sits off the straight line
 * @param {number} [labelGap] extra push, beyond the curve, for the label
 */
export function curvedEdgePath(from, to, r, side, offset = 36, labelGap = 12) {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  // The perpendicular basis is derived from the *unordered* pair (canonicalized
  // to a single direction below) rather than this edge's own from->to vector.
  // A reverse edge (B->A) has an exactly negated dx/dy, which would otherwise
  // flip px/py's sign too — silently canceling the caller's `side` flip, so
  // both directions of a bidirectional pair computed the identical control
  // point and rendered as one curve on top of the other instead of mirrored
  // arcs (found by actually creating a q0->q1 then q1->q0 pair in the app).
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  if (dx < 0 || (dx === 0 && dy < 0)) {
    dx = -dx;
    dy = -dy;
  }
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const px = -dy / dist;
  const py = dx / dist;
  const control = { x: mx + px * offset * side, y: my + py * offset * side };
  const p0 = pointTowards(from, control, r);
  const p1 = pointTowards(to, control, r);
  const label = quadMidpoint(p0, control, p1);
  return {
    d: `M${p0.x},${p0.y} Q${control.x},${control.y} ${p1.x},${p1.y}`,
    labelX: label.x + px * labelGap * side,
    labelY: label.y + py * labelGap * side,
  };
}

function pointTowards(center, target, r) {
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: center.x + (dx / dist) * r, y: center.y + (dy / dist) * r };
}

function cubicMidpoint(p0, c0, c1, p1) {
  return {
    x: 0.125 * p0.x + 0.375 * c0.x + 0.375 * c1.x + 0.125 * p1.x,
    y: 0.125 * p0.y + 0.375 * c0.y + 0.375 * c1.y + 0.125 * p1.y,
  };
}

function quadMidpoint(p0, control, p1) {
  return {
    x: 0.25 * p0.x + 0.5 * control.x + 0.25 * p1.x,
    y: 0.25 * p0.y + 0.5 * control.y + 0.25 * p1.y,
  };
}

/**
 * Status-bar summary (task 7.4: "DFA/NFA classification + state/transition
 * counts"). Transition count follows kflap-v0.1's delta-table convention:
 * one row per (state, symbol) pair, i.e. one per symbol on an edge (an
 * epsilon-only edge with no symbols still counts as exactly one
 * transition).
 * @param {{states: any[], edges: {symbols:string[], epsilon?:boolean}[], derived: {classification:string, alphabet:string[], unreachable:number[]}}} doc
 */
export function statusSummary(doc) {
  const transitionCount = doc.edges.reduce((sum, e) => {
    const symbolCount = e.symbols?.length ?? 0;
    return sum + Math.max(symbolCount, e.epsilon ? 1 : 0);
  }, 0);
  return {
    classification: doc.derived.classification,
    stateCount: doc.states.length,
    transitionCount,
    alphabetSize: doc.derived.alphabet.length,
    unreachableCount: doc.derived.unreachable.length,
  };
}
