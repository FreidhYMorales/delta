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
