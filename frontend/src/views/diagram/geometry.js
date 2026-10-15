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
 * Grid layout for "Organizar": every state lands on an integer (column, row)
 * cell, columns flowing left-to-right by longest-path distance from
 * `initialId`, rows chosen so the diagram stays readable with every edge
 * drawn as ONE straight segment (or the renderer's arc pair for A<->B).
 *
 * No waypoints, no bends: an edge's shape depends only on its two endpoint
 * states, so dragging a state afterwards can never leave a stale kink
 * behind — the problem the old dummy-waypoint routing had.
 *
 * Readability guarantee: rows are optimized so no straight edge runs over a
 * state that is not one of its own endpoints. That alone rules out two
 * edges lying on top of each other: two collinear segments can only share
 * a stretch if one of them passes over the other's endpoint state. Edges
 * may still CROSS (penalized, not forbidden) — crossing at an angle reads
 * fine; lying on top of each other does not.
 *
 * Shape: the diagram reads like a hand-drawn Thompson construction — a
 * straight spine from the initial state, each union a symmetric diamond
 * (fork and join centered between their branches), and loop-back/bypass
 * edges running level along a row nothing else sits on.
 *
 * Steps:
 * 1. Columns: longest-path layering over the edges left after one DFS drops
 *    each cycle's back edge (the back edge is still drawn, it just doesn't
 *    push columns around). A 2-cycle whose second state has another,
 *    earlier predecessor is stacked in one column instead (A->B, A->C,
 *    B<->C draws as B over C, joined by two arcs).
 * 2. Initial row order: Sugiyama barycenter sweep (dummy nodes stand in for
 *    long edges ONLY during this ordering step, never in the output).
 * 3. Rows, on a half-row grid: start each column symmetric around the
 *    spine's row, then a deterministic local search — move or swap one
 *    state within its column, or shift a whole block of columns — keeping
 *    any move that lowers the cost (see the COST_* weights). If an edge
 *    still runs over a state, a bounded escape step kicks it off and
 *    re-settles the neighborhood.
 * 4. Drop empty rows whenever doing so doesn't make the layout worse.
 *
 * @param {{id:number}[]} states
 * @param {{from:number, to:number}[]} edges self-loops ignored
 * @param {number|undefined} initialId column 0's preferred root; optional
 * @param {{centerX:number, centerY:number, columnSpacing?:number, rowSpacing?:number, clearance?:number}} opts
 *   `clearance`: minimum distance between a state's center and any edge
 *   not attached to it (state radius plus a visible margin).
 * @returns {{positions: {id:number, x:number, y:number}[]}}
 */
export function layeredLayout(
  states,
  edges,
  initialId,
  { centerX, centerY, columnSpacing = 160, rowSpacing = 90, clearance = 32 },
) {
  const n = states.length;
  if (n === 0) return { positions: [] };
  if (n === 1) return { positions: [{ id: states[0].id, x: centerX, y: centerY }] };

  const ids = states.map((s) => s.id);
  const idSet = new Set(ids);
  const links = edges.filter((e) => e.from !== e.to && idSet.has(e.from) && idSet.has(e.to));

  const layer = assignLayers(ids, links, initialId);
  const rowOrder = orderLayers(ids, links, layer);
  const row = assignRows(ids, links, layer, rowOrder, { columnSpacing, rowSpacing, clearance });

  const layerCount = Math.max(...ids.map((id) => layer.get(id))) + 1;
  const rows = ids.map((id) => row.get(id));
  const midRow = (Math.min(...rows) + Math.max(...rows)) / 2;
  const positions = ids.map((id) => ({
    id,
    x: centerX + (layer.get(id) - (layerCount - 1) / 2) * columnSpacing,
    y: centerY + (row.get(id) - midRow) * (rowSpacing / 2), // rows are half-row units
  }));
  return { positions };
}

/**
 * Column per state: longest path over the edges that survive one DFS's
 * back-edge removal. Longest (not shortest) path, so a shortcut edge never
 * lands inside a single column. The DFS starts at `initialId` so its own
 * cycles break relative to it; a state with no incoming kept edge (including
 * one unreachable from `initialId`) roots its own column-0 chain. Iterative
 * (explicit stack): a long chain of states must never blow the JS stack.
 */
function assignLayers(ids, links, initialId) {
  const rawAdj = new Map(ids.map((id) => [id, []]));
  for (const e of links) rawAdj.get(e.from).push(e.to);

  const UNVISITED = 0;
  const IN_PROGRESS = 1;
  const DONE = 2;
  const color = new Map(ids.map((id) => [id, UNVISITED]));
  const forwardAdj = new Map(ids.map((id) => [id, []]));
  const inDegree = new Map(ids.map((id) => [id, 0]));
  const visitStarts = rawAdj.has(initialId) ? [initialId, ...ids] : ids;
  for (const start of visitStarts) {
    if (color.get(start) !== UNVISITED) continue;
    const stack = [{ id: start, next: 0 }];
    color.set(start, IN_PROGRESS);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const neighbors = rawAdj.get(frame.id);
      if (frame.next >= neighbors.length) {
        color.set(frame.id, DONE);
        stack.pop();
        continue;
      }
      const neighbor = neighbors[frame.next++];
      if (color.get(neighbor) === IN_PROGRESS) continue; // back edge
      forwardAdj.get(frame.id).push(neighbor);
      inDegree.set(neighbor, inDegree.get(neighbor) + 1);
      if (color.get(neighbor) === UNVISITED) {
        color.set(neighbor, IN_PROGRESS);
        stack.push({ id: neighbor, next: 0 });
      }
    }
  }

  // Kahn's topological order, `initialId` first among the ready roots.
  const remaining = new Map(inDegree);
  const queue = ids.filter((id) => remaining.get(id) === 0);
  queue.sort((a, b) => (a === initialId ? -1 : b === initialId ? 1 : 0));
  const layer = new Map(ids.map((id) => [id, 0]));
  while (queue.length) {
    const id = queue.shift();
    for (const next of forwardAdj.get(id)) {
      layer.set(next, Math.max(layer.get(next), layer.get(id) + 1));
      remaining.set(next, remaining.get(next) - 1);
      if (remaining.get(next) === 0) queue.push(next);
    }
  }

  // Stack a 2-cycle u<->v vertically (same column, drawn as two arcs) when
  // longest-path layering pushed v one column past u only because of u->v:
  // v's other forward predecessors all sit left of u, and nothing forward
  // of v would end up in or left of v's new column. Without another
  // predecessor, v stays after u — a lone loop (a*) still reads as a step.
  const predecessors = new Map(ids.map((id) => [id, []]));
  for (const [id, nexts] of forwardAdj) for (const next of nexts) predecessors.get(next).push(id);
  for (const [u, nexts] of forwardAdj) {
    for (const v of nexts) {
      if (!rawAdj.get(v).includes(u) || layer.get(v) !== layer.get(u) + 1) continue;
      const others = predecessors.get(v).filter((p) => p !== u);
      if (!others.length || others.some((p) => layer.get(p) >= layer.get(u))) continue;
      if (forwardAdj.get(v).some((w) => w !== u && layer.get(w) <= layer.get(u))) continue;
      layer.set(v, layer.get(u));
    }
  }
  return layer;
}

/**
 * Barycenter sweep (Sugiyama's crossing-reduction step): an initial row
 * ORDER per column, which the local search in `assignRows` then refines.
 * Edges spanning >=2 columns are temporarily split into dummy chains so
 * they take part in the sweep; dummies are dropped from the result.
 * @returns {Map<number, number[]>} column -> real state ids, top to bottom
 */
function orderLayers(ids, links, layer) {
  const byLayer = new Map();
  const add = (l, id) => {
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l).push(id);
  };
  for (const id of ids) add(layer.get(id), id);

  const adj = new Map();
  const connect = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  };
  for (const e of links) {
    const from = layer.get(e.from);
    const to = layer.get(e.to);
    const step = to > from ? 1 : -1;
    let prev = e.from;
    for (let l = from + step; Math.abs(to - from) >= 2 && l !== to; l += step) {
      const dummyId = `dummy:${e.from}->${e.to}@${l}`;
      add(l, dummyId);
      connect(prev, dummyId);
      prev = dummyId;
    }
    connect(prev, e.to);
  }

  const layerNums = [...byLayer.keys()].sort((a, b) => a - b);
  const index = new Map();
  for (const l of layerNums) byLayer.get(l).forEach((id, i) => index.set(id, { layer: l, i }));

  for (let pass = 0; pass < 4; pass++) {
    const forward = pass % 2 === 0;
    for (const l of forward ? layerNums : [...layerNums].reverse()) {
      const current = byLayer.get(l);
      if (current.length < 2) continue;
      const adjacent = forward ? l - 1 : l + 1;
      const keyed = current.map((id, i) => {
        const rows = [...(adj.get(id) ?? [])]
          .map((other) => index.get(other))
          .filter((p) => p.layer === adjacent)
          .map((p) => p.i);
        // No neighbor on that side: keep its own index so it holds its spot.
        const barycenter = rows.length ? rows.reduce((s, r) => s + r, 0) / rows.length : i;
        return { id, i, barycenter };
      });
      keyed.sort((a, b) => a.barycenter - b.barycenter || a.i - b.i);
      const next = keyed.map((k) => k.id);
      byLayer.set(l, next);
      next.forEach((id, i) => index.set(id, { layer: l, i }));
    }
  }

  const result = new Map();
  for (const l of layerNums) result.set(l, byLayer.get(l).filter((id) => typeof id !== "string"));
  return result;
}

// Cost weights for `assignRows`. An edge running over a foreign state is
// what makes a diagram unreadable, so it dominates everything else; two
// edges leaving one state almost in the same direction read as one line
// near that state, so that is nearly as bad; a crossing is acceptable but
// worth avoiding. The two shape terms are what draw Thompson-style
// diagrams: row span keeps the spine and each branch straight, and balance
// centers a fork (or join) between its branches, so a union reads as a
// symmetric diamond instead of one branch continuing the spine.
const COST_RUNS_OVER_STATE = 1000;
const COST_NEAR_PARALLEL = 300;
const COST_CROSSING = 20;
const COST_ROW_SPAN = 3;
const COST_UNBALANCED = 4;
const MIN_EDGE_ANGLE = (15 * Math.PI) / 180;
// An A<->B pair is drawn as two arcs (`curvedEdgePath`, default offset 36)
// rather than one line: each arc leaves its state angled away from the
// chord and bulges up to half that offset from it, so the cost treats such
// a pair as wider than a single straight edge.
const PAIR_ARC_OFFSET = 36;
const MAX_SEARCH_PASSES = 30;
const MAX_ESCAPES = 8;
const ESCAPE_SEARCH_PASSES = 3;
const ESCAPE_REACH = 2; // columns around a kick that re-settle
const MAX_SHIFT = 12; // largest block shift tried, in half-row units
// A block shift only pays off across a narrow cut (a spine, a loop's
// return edge); across a wide one some edge always gets worse.
const MAX_SHIFT_CUT = 8;

/**
 * Row per state, in half-row units (`rowSpacing / 2`): two states of one
 * column stay at least a full `rowSpacing` apart, but a column can sit
 * half a row off its neighbor, which is what lets a fork sit exactly
 * between its two branches. Starts from `rowOrder`, then hill-climbs: for
 * each state, try every nearby row of its column (moving there, or
 * swapping with the state already there), then try shifting whole blocks
 * of columns; keep any strictly-improving option until nothing improves.
 * Deterministic — no RNG.
 * @returns {Map<number, number>} state id -> row, in half-row units
 */
function assignRows(ids, links, layer, rowOrder, { columnSpacing, rowSpacing, clearance }) {
  // Everything below works on dense indices (0..n-1) and flat arrays: the
  // search evaluates the cost thousands of times, so it avoids Maps and
  // per-call object allocation in its inner loops.
  const n = ids.length;
  const unit = rowSpacing / 2;
  const MIN_GAP = 2; // same-column spacing, in units
  const indexOf = new Map(ids.map((id, i) => [id, i]));
  const col = Int32Array.from(ids, (id) => layer.get(id));
  const px = Float64Array.from(col, (c) => c * columnSpacing);
  const py = new Float64Array(n);
  const row = new Int32Array(n);
  const setRow = (i, r) => {
    row[i] = r;
    py[i] = r * unit;
  };

  const segmentByKey = new Map();
  for (const e of links) {
    const from = indexOf.get(e.from);
    const to = indexOf.get(e.to);
    const key = Math.min(from, to) * n + Math.max(from, to);
    const existing = segmentByKey.get(key);
    // A->B and B->A share one segment, flagged as a two-arc pair.
    if (existing) existing.pair ||= existing.from !== from;
    else segmentByKey.set(key, { from, to, pair: false });
  }
  const segments = [...segmentByKey.values()];
  const segA = Int32Array.from(segments, (s) => s.from);
  const segB = Int32Array.from(segments, (s) => s.to);
  const isPair = Uint8Array.from(segments, (s) => (s.pair ? 1 : 0));
  const segmentCount = segA.length;
  // How far (radians) a segment's drawing fans out from its chord at each
  // end: 0 for a straight edge, the arc's tangent angle for a pair.
  const spread = (s) =>
    isPair[s] ? Math.atan((2 * PAIR_ARC_OFFSET) / Math.hypot(px[segB[s]] - px[segA[s]], py[segB[s]] - py[segA[s]])) : 0;

  // Neighbors in the column just left / just right of each state — the
  // ones `COST_UNBALANCED` centers it between.
  const left = Array.from({ length: n }, () => []);
  const right = Array.from({ length: n }, () => []);
  for (let s = 0; s < segmentCount; s++) {
    const a = segA[s];
    const b = segB[s];
    if (col[b] === col[a] + 1) {
      right[a].push(b);
      left[b].push(a);
    } else if (col[a] === col[b] + 1) {
      right[b].push(a);
      left[a].push(b);
    }
  }
  const balanceNeighbors = Array.from({ length: n }, (_, i) => [...new Set([...left[i], ...right[i]])]);
  const imbalance = (side, i) => {
    if (side.length < 2) return 0;
    let sum = 0;
    for (const j of side) sum += row[j];
    return Math.abs(row[i] - sum / side.length);
  };

  const columns = new Map(); // column -> member indices
  for (let i = 0; i < n; i++) {
    if (!columns.has(col[i])) columns.set(col[i], []);
    columns.get(col[i]).push(i);
  }
  // Initial rows: each column's order, symmetric around row 0, leaving a
  // gap at row 0 wide enough for whatever runs past the column there — a
  // straight edge needs half a row each side, an arc pair a full row. So a
  // union already starts as a diamond around its fork's row, with the
  // spine and any bypass along it clear between the branches. An odd
  // column keeps one state on row 0; the search moves it if it's in the
  // way. The search range follows the layout, so there is no fixed height.
  const centerGap = new Int32Array(Math.max(...col) + 1).fill(1);
  for (let s = 0; s < segmentCount; s++) {
    const reach = isPair[s] ? clearance + PAIR_ARC_OFFSET / 2 : clearance;
    const gap = Math.max(1, Math.ceil(reach / unit));
    const lo = Math.min(col[segA[s]], col[segB[s]]);
    const hi = Math.max(col[segA[s]], col[segB[s]]);
    for (let c = lo + 1; c < hi; c++) centerGap[c] = Math.max(centerGap[c], gap);
  }
  for (const [c, column] of rowOrder) {
    const k = column.length;
    const half = Math.floor(k / 2);
    column.forEach((id, j) => {
      const r =
        k % 2 === 1
          ? MIN_GAP * (j - half)
          : j < half
            ? -(centerGap[c] + MIN_GAP * (half - 1 - j))
            : centerGap[c] + MIN_GAP * (j - half);
      setRow(indexOf.get(id), r);
    });
  }

  const runsOver = (s, i) => {
    const a = segA[s];
    const b = segB[s];
    if (i === a || i === b) return false;
    const x = px[i];
    const y = py[i];
    const reach = isPair[s] ? clearance + PAIR_ARC_OFFSET / 2 : clearance;
    // Cheap reject: outside the segment's bounding box grown by `reach`.
    if (x < Math.min(px[a], px[b]) - reach || x > Math.max(px[a], px[b]) + reach) return false;
    if (y < Math.min(py[a], py[b]) - reach || y > Math.max(py[a], py[b]) + reach) return false;
    return distanceToSegment2(x, y, px[a], py[a], px[b], py[b]) < reach * reach;
  };

  const pairCost = (s, t) => {
    const a = segA[s];
    const b = segB[s];
    const c = segA[t];
    const d = segB[t];
    const shared = a === c || a === d ? a : b === c || b === d ? b : -1;
    if (shared < 0) return segmentsCross(px[a], py[a], px[b], py[b], px[c], py[c], px[d], py[d]) ? COST_CROSSING : 0;
    const u = shared === a ? b : a;
    const w = shared === c ? d : c;
    const angle = angleAt(px[shared], py[shared], px[u], py[u], px[w], py[w]);
    return angle < MIN_EDGE_ANGLE + spread(s) + spread(t) ? COST_NEAR_PARALLEL : 0;
  };

  // Sum of every cost term that involves at least one state in `moved` —
  // the only terms a move of those states can change, so comparing this
  // before/after a move gives the exact change in total cost.
  const isMoved = new Uint8Array(n);
  const isBalanced = new Uint8Array(n);
  const costInvolving = (moved) => {
    for (const i of moved) isMoved[i] = 1;
    const touches = (s) => isMoved[segA[s]] === 1 || isMoved[segB[s]] === 1;
    let cost = 0;
    for (let s = 0; s < segmentCount; s++) {
      if (!touches(s)) {
        for (const i of moved) if (runsOver(s, i)) cost += COST_RUNS_OVER_STATE;
        continue;
      }
      cost += COST_ROW_SPAN * Math.abs(row[segA[s]] - row[segB[s]]);
      for (let i = 0; i < n; i++) if (runsOver(s, i)) cost += COST_RUNS_OVER_STATE;
      for (let t = 0; t < segmentCount; t++) {
        if (t === s || (t < s && touches(t))) continue; // count each pair once
        cost += pairCost(s, t);
      }
    }
    // A state's balance depends on its own row and its side neighbors'.
    const affected = [];
    for (const i of moved) for (const j of [i, ...balanceNeighbors[i]]) if (!isBalanced[j]) {
      isBalanced[j] = 1;
      affected.push(j);
    }
    for (const j of affected) {
      cost += COST_UNBALANCED * (imbalance(left[j], j) + imbalance(right[j], j));
      isBalanced[j] = 0;
    }
    for (const i of moved) isMoved[i] = 0;
    return cost;
  };

  // Where state `i` could go in row `r`: a plain move if nothing in its
  // column is within MIN_GAP, a swap with the one state sitting exactly at
  // `r` if that state fits at `i`'s old row, otherwise nowhere.
  const partnerAt = (i, r) => {
    let partner = -1;
    for (const j of columns.get(col[i])) {
      if (j === i || Math.abs(row[j] - r) >= MIN_GAP) continue;
      if (row[j] !== r || partner >= 0) return null;
      partner = j;
    }
    if (partner >= 0) {
      for (const j of columns.get(col[i])) {
        if (j !== i && j !== partner && Math.abs(row[j] - row[i]) < MIN_GAP) return null;
      }
    }
    return partner;
  };
  const moveOrSwap = (i, r, partner) => {
    if (partner >= 0) setRow(partner, row[i]);
    setRow(i, r);
  };

  // Cost terms a block shift can change, given `affected`: every segment
  // not entirely inside the block whose column span overlaps it. The block
  // and the rest occupy disjoint x ranges (a full `columnSpacing` apart,
  // wider than any clearance), so a segment entirely inside keeps its
  // shape and can't reach a state outside, and a segment entirely outside
  // can only interact with the block if it passes over it — which puts it
  // in `affected`. So only affected segments change: their own span, what
  // they run over or cross, and the balance of their endpoints.
  const costAffected = (affected) => {
    let cost = 0;
    const endpoints = new Set();
    for (const s of affected) {
      cost += COST_ROW_SPAN * Math.abs(row[segA[s]] - row[segB[s]]);
      for (let i = 0; i < n; i++) if (runsOver(s, i)) cost += COST_RUNS_OVER_STATE;
      for (let t = 0; t < segmentCount; t++) {
        if (t === s || (t < s && affected.includes(t))) continue; // count each pair once
        cost += pairCost(s, t);
      }
      endpoints.add(segA[s]);
      endpoints.add(segB[s]);
    }
    for (const j of endpoints) cost += COST_UNBALANCED * (imbalance(left[j], j) + imbalance(right[j], j));
    return cost;
  };

  // Block move: shift every state in columns [c1, c2] by the same amount.
  // One state at a time can't straighten a spine whose two halves settled
  // at different heights, or re-center a whole union between its fork and
  // join (every single step in between costs more before it pays off);
  // shifting the block at once can.
  const maxColumn = Math.max(...col);
  const shiftBlock = (c1, c2) => {
    const inBlock = (i) => col[i] >= c1 && col[i] <= c2;
    const affected = [];
    for (let s = 0; s < segmentCount; s++) {
      const a = segA[s];
      const b = segB[s];
      if (inBlock(a) && inBlock(b)) continue;
      if (Math.max(col[a], col[b]) >= c1 && Math.min(col[a], col[b]) <= c2) affected.push(s);
      if (affected.length > MAX_SHIFT_CUT) return false;
    }
    const moved = [];
    for (let i = 0; i < n; i++) if (inBlock(i)) moved.push(i);
    const shift = (d) => {
      for (const i of moved) setRow(i, row[i] + d);
    };
    const before = costAffected(affected);
    let bestShift = 0;
    let bestDelta = -1e-9;
    for (let d = -MAX_SHIFT; d <= MAX_SHIFT; d++) {
      if (d === 0) continue;
      shift(d);
      const delta = costAffected(affected) - before;
      shift(-d);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestShift = d;
      }
    }
    if (bestShift === 0) return false;
    shift(bestShift);
    return true;
  };
  // Suffix blocks only: a column range in the middle would also need its
  // far side re-aligned, which the next suffix shift already covers.
  const shiftBlocks = () => {
    let improved = false;
    for (let c = 1; c <= maxColumn; c++) if (shiftBlock(c, maxColumn)) improved = true;
    return improved;
  };

  // Last resort for an edge still running over a state: a local optimum
  // where clearing it takes two moves, each worse on its own. Kick the
  // state off the edge (nearest clear rows above and below), let the
  // search settle again, and keep the result only if the total cost
  // dropped. Bounded, and only runs while a violation remains.
  const everyone = [...Array(n).keys()];
  const firstRunOver = () => {
    for (let s = 0; s < segmentCount; s++) for (let i = 0; i < n; i++) if (runsOver(s, i)) return { s, i };
    return null;
  };
  // First row in direction `dir` (within a few rows) where state `x` fits
  // its column and segment `s` sits clear of state `i` (x is either `i`
  // itself or one of the segment's endpoints), or null.
  const nearestClearRow = (x, s, i, dir) => {
    const start = row[x];
    for (let r = start + dir; Math.abs(r - start) <= 4 * MIN_GAP; r += dir) {
      const partner = partnerAt(x, r);
      if (partner === null) continue;
      moveOrSwap(x, r, partner);
      const clear = !runsOver(s, i);
      moveOrSwap(x, start, partner);
      if (clear) return { r, partner };
    }
    return null;
  };
  const escapeRunOvers = () => {
    for (let attempt = 0; attempt < MAX_ESCAPES; attempt++) {
      const hit = firstRunOver();
      if (!hit) return;
      const total = costInvolving(everyone);
      const saved = Int32Array.from(row);
      let escaped = false;
      // Kick the covered state, or either end of the edge covering it.
      for (const x of [hit.i, segA[hit.s], segB[hit.s]]) {
        for (const dir of [-1, 1]) {
          const kick = nearestClearRow(x, hit.s, hit.i, dir);
          if (!kick) continue;
          moveOrSwap(x, kick.r, kick.partner);
          // Only the kick's neighborhood needs to settle again.
          const near = new Set([hit.i, segA[hit.s], segB[hit.s]]);
          for (let k = 0; k < n; k++) if (Math.abs(col[k] - col[x]) <= ESCAPE_REACH) near.add(k);
          hillClimb(ESCAPE_SEARCH_PASSES, near);
          if (costInvolving(everyone) < total) {
            escaped = true;
            break;
          }
          saved.forEach((r0, k) => setRow(k, r0));
        }
        if (escaped) break;
      }
      if (!escaped) return;
    }
  };

  const searchOrder = [...rowOrder.values()].flat().map((id) => indexOf.get(id));
  // `only`: restrict to these states and skip block shifts (used to
  // re-settle just the neighborhood of an escape kick).
  const hillClimb = (maxPasses = MAX_SEARCH_PASSES, only = null) => {
    const order = only ? searchOrder.filter((i) => only.has(i)) : searchOrder;
    for (let pass = 0; pass < maxPasses; pass++) {
      let improved = false;
      for (const i of order) {
        const start = row[i];
        let best = null;
        let bestDelta = -1e-9;
        const beforeAlone = costInvolving([i]); // same for every plain move
        const lo = Math.min(...row) - 2 * MIN_GAP;
        const hi = Math.max(...row) + 2 * MIN_GAP;
        for (let r = lo; r <= hi; r++) {
          if (r === start) continue;
          const partner = partnerAt(i, r);
          if (partner === null) continue;
          const moved = partner < 0 ? [i] : [i, partner];
          const before = partner < 0 ? beforeAlone : costInvolving(moved);
          moveOrSwap(i, r, partner);
          const delta = costInvolving(moved) - before;
          moveOrSwap(i, start, partner);
          if (delta < bestDelta) {
            bestDelta = delta;
            best = { r, partner };
          }
        }
        if (best) {
          moveOrSwap(i, best.r, best.partner);
          improved = true;
        }
      }
      if (!only && shiftBlocks()) improved = true;
      if (!improved) break;
    }
  };

  hillClimb();
  escapeRunOvers();

  // Collapse rows no state uses, top to bottom, whenever that keeps the
  // total cost from rising (an empty row between two busy ones may be what
  // keeps an edge off a state). Collapsing never breaks MIN_GAP: nothing
  // sat on row `r`, so no same-column pair straddles it at distance < 2...
  // except a pair exactly 2 apart around it, which the check below skips.
  let total = costInvolving(everyone);
  for (let r = Math.max(...row) - 1; r > Math.min(...row); r--) {
    if (row.includes(r)) continue;
    const straddled = [...columns.values()].some((members) =>
      members.some((i) => row[i] === r - 1 && members.some((j) => row[j] === r + 1)),
    );
    if (straddled) continue;
    const saved = Int32Array.from(row);
    for (let i = 0; i < n; i++) if (row[i] > r) setRow(i, row[i] - 1);
    const collapsed = costInvolving(everyone);
    if (collapsed <= total) total = collapsed;
    else saved.forEach((r0, i) => setRow(i, r0));
  }
  return new Map(ids.map((id, i) => [id, row[i]]));
}

/** Squared distance from (x, y) to the segment (ax, ay)-(bx, by). */
function distanceToSegment2(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
  const ex = x - (ax + t * dx);
  const ey = y - (ay + t * dy);
  return ex * ex + ey * ey;
}

/** Angle (radians) at vertex v between the rays v->u and v->w. */
function angleAt(vx, vy, ux, uy, wx, wy) {
  const ax = ux - vx;
  const ay = uy - vy;
  const bx = wx - vx;
  const by = wy - vy;
  const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

/** Proper crossing of segments a-b and c-d (no shared endpoint). */
function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const orient = (x1, y1, x2, y2, x3, y3) => Math.sign((x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1));
  return (
    orient(ax, ay, bx, by, cx, cy) * orient(ax, ay, bx, by, dx, dy) < 0 &&
    orient(cx, cy, dx, dy, ax, ay) * orient(cx, cy, dx, dy, bx, by) < 0
  );
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
 * Heuristic (DOM-free) bounding-box estimate for one edge label, sized for
 * the 12px system-ui `.edge-label` font (style.css). Deliberately NOT a
 * real `getBBox()`/`measureText()` measurement: that would force a
 * synchronous layout read per label on every full render, which is exactly
 * the per-element reflow cost `DiagramView._patchDragPosition` exists to
 * avoid (a full-render label pass reading real metrics for every edge would
 * reintroduce it one level up). A transition label is always a short
 * comma-joined symbol list ("a,b,ε"), never free-form prose, so a fixed
 * average-char-width estimate is close enough — it only needs to be
 * consistent with itself, since the same estimate sizes both the
 * background halo rect and the `resolveLabelOverlaps` collision math below,
 * so the two never disagree with each other even where both differ
 * slightly from the true glyph metrics. `paddingX`/`paddingY` default well
 * past the glyph's own ink — a single-character label like "ε" has almost
 * no true bounding box, so a tight estimate would tell `resolveLabelOverlaps`
 * two nearby single-char labels barely overlap even when they read as
 * crowded on screen (found live: two routed edges' "ε" labels sitting a few
 * px apart, technically non-overlapping boxes but not clearly two separate
 * labels either). The padding is what gives every label a "personal space"
 * radius, not just a hitbox.
 * @param {string} text
 * @param {{charWidth?:number, paddingX?:number, lineHeight?:number, paddingY?:number}} [opts]
 * @returns {{width:number, height:number}}
 */
export function estimateLabelSize(text, { charWidth = 7, paddingX = 10, lineHeight = 14, paddingY = 4 } = {}) {
  const length = Math.max(text.length, 1);
  return {
    width: length * charWidth + paddingX * 2,
    height: lineHeight + paddingY * 2,
  };
}

/**
 * Iterative relaxation pass that nudges apart any two label rectangles
 * that overlap. Every edge's label position (`curvedEdgePath`/
 * `selfLoopPath`'s `labelX/labelY`, or the plain-edge
 * midpoint math in `DiagramView._computeEdgeGeometry`) is computed against
 * that ONE edge's own geometry only — nothing before this function ever
 * compares one edge's label to another's, so two independently-placed
 * labels can land on top of each other once an automaton is dense enough
 * (see docs/wip-organizar-layout.md — the gap the rest of this "Organizar"
 * work was paused on).
 *
 * Same relaxation-pass shape as `resolveOverlaps` for states above, but:
 * (a) label rectangles, not circles, so overlap is an axis-aligned
 * bounding-box test, not a distance check, and separation picks whichever
 * axis has LESS overlap (the smaller nudge that actually clears the two
 * rectangles, same "minimum translation vector" idea most 2D physics
 * engines use for AABB separation) rather than a single fixed axis; (b)
 * bounded by `maxDrift` from each label's OWN original anchor, re-clamped
 * every pass so an intermediate push is never undone later — unlike a
 * state (free to end up anywhere the spring simulation likes), a label
 * that drifts too far from its own edge stops reading as belonging to that
 * edge, or wanders into a neighboring routing lane's own space. Returns a
 * NEW array (`layeredLayout`'s immutability convention — `resolveOverlaps`
 * mutates in place, but that one is an internal-only helper, while this is
 * a public export other code reasons about the return value of).
 * @param {{key:string, x:number, y:number, width:number, height:number}[]} labels
 * @param {{maxDrift?:number, passes?:number}} [opts]
 *   `maxDrift`: hard cap on how far a label may move from its own original
 *   `(x,y)`.
 * @returns {{key:string, x:number, y:number}[]}
 */
export function resolveLabelOverlaps(labels, { maxDrift = 10, passes = 6 } = {}) {
  const anchors = new Map(labels.map((l) => [l.key, { x: l.x, y: l.y }]));
  const sizes = new Map(labels.map((l) => [l.key, { width: l.width, height: l.height }]));
  const current = labels.map((l) => ({ key: l.key, x: l.x, y: l.y }));

  const clampToAnchor = (p) => {
    const anchor = anchors.get(p.key);
    const dx = p.x - anchor.x;
    const dy = p.y - anchor.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= maxDrift || dist === 0) return p;
    const scale = maxDrift / dist;
    return { key: p.key, x: anchor.x + dx * scale, y: anchor.y + dy * scale };
  };

  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const a = current[i];
        const b = current[j];
        const sizeA = sizes.get(a.key);
        const sizeB = sizes.get(b.key);
        const overlapX = (sizeA.width + sizeB.width) / 2 - Math.abs(a.x - b.x);
        const overlapY = (sizeA.height + sizeB.height) / 2 - Math.abs(a.y - b.y);
        if (overlapX <= 0 || overlapY <= 0) continue; // AABBs don't overlap

        if (overlapX < overlapY) {
          const push = overlapX / 2 + 0.5;
          const dir = a.x <= b.x ? -1 : 1;
          current[i] = clampToAnchor({ key: a.key, x: a.x + dir * push, y: a.y });
          current[j] = clampToAnchor({ key: b.key, x: b.x - dir * push, y: b.y });
        } else {
          const push = overlapY / 2 + 0.5;
          const dir = a.y <= b.y ? -1 : 1;
          current[i] = clampToAnchor({ key: a.key, x: a.x, y: a.y + dir * push });
          current[j] = clampToAnchor({ key: b.key, x: b.x, y: b.y - dir * push });
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return current;
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
