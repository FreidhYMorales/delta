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
 * Force-directed ("spring embedder", Fruchterman-Reingold-style) layout:
 * every pair of states repels, and each edge pulls its two endpoints
 * together, so states with more transitions between them end up close and
 * unrelated states drift apart — unlike `circleLayout`, which spaces every
 * state by the same fixed angle regardless of how it connects to anything,
 * and degrades into a crowded ring as state count grows.
 * @param {{id:number}[]} states
 * @param {{from:number, to:number}[]} edges self-loops (`from === to`) are dropped — pulling a state toward itself does nothing but waste an iteration
 * @param {{centerX:number, centerY:number, minSeparation?:number, idealEdgeLength?:number, iterations?:number}} opts
 *   `minSeparation`: hard floor between any two states' centers, enforced in
 *   a cleanup pass after the simulation settles — a small fully-connected
 *   graph can still converge closer than this on its own.
 *   `idealEdgeLength`: target spacing for a *connected* pair, held constant
 *   regardless of state count (deriving it from state count, as an earlier
 *   version did, made it balloon for larger automatons — a 58-state graph
 *   would want ~800px between connected states, which is exactly why loosely
 *   linked clusters used to end up as far-flung islands joined by long
 *   crossing edges instead of one compact diagram).
 * @returns {{id:number, x:number, y:number}[]}
 */
export function forceDirectedLayout(
  states,
  edges,
  { centerX, centerY, minSeparation = 90, idealEdgeLength = 130, iterations = 300 },
) {
  const n = states.length;
  if (n === 0) return [];
  if (n === 1) return [{ id: states[0].id, x: centerX, y: centerY }];

  // Seed from `circleLayout` itself: a deterministic, already-spread
  // starting point (no RNG to make results flaky/hard to test) that never
  // starts two states on the exact same point — repulsion divides by
  // distance, and a zero distance would make the first iteration's
  // direction undefined. This seed radius growing with `n` is fine — it's
  // only a starting point the simulation immediately reworks — unlike `k`
  // below, which drives the actual equilibrium spacing.
  const seedRadius = Math.max(minSeparation, (idealEdgeLength * n) / (2 * Math.PI));
  const pos = circleLayout(states, { centerX, centerY, radius: seedRadius }).map((p) => ({ ...p }));
  const index = new Map(pos.map((p, i) => [p.id, i]));
  const links = edges.filter((e) => e.from !== e.to && index.has(e.from) && index.has(e.to));

  const k = idealEdgeLength;
  // A gentle, constant pull toward the center for every state, independent
  // of edges: helps the simulation settle into one cohesive blob rather
  // than several instead of relying on it alone — the hard guarantee
  // against far-flung, loosely-linked clusters is `compactToTarget` below,
  // since gravity's pull can only ever compete with, not reliably beat,
  // however much repulsion a particular graph shape happens to generate.
  const gravity = 0.05;

  let temperature = Math.min(seedRadius / 2, idealEdgeLength);
  for (let iter = 0; iter < iterations; iter++) {
    const disp = pos.map(() => ({ x: 0, y: 0 }));

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x;
        const dy = pos[i].y - pos[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (k * k) / dist;
        const ux = dx / dist;
        const uy = dy / dist;
        disp[i].x += ux * force;
        disp[i].y += uy * force;
        disp[j].x -= ux * force;
        disp[j].y -= uy * force;
      }
    }

    for (const e of links) {
      const i = index.get(e.from);
      const j = index.get(e.to);
      const dx = pos[i].x - pos[j].x;
      const dy = pos[i].y - pos[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist * dist) / k;
      const ux = dx / dist;
      const uy = dy / dist;
      disp[i].x -= ux * force;
      disp[i].y -= uy * force;
      disp[j].x += ux * force;
      disp[j].y += uy * force;
    }

    for (let i = 0; i < n; i++) {
      disp[i].x += (centerX - pos[i].x) * gravity;
      disp[i].y += (centerY - pos[i].y) * gravity;
    }

    // Cap each state's move to the current temperature, which cools every
    // iteration — without this the layout oscillates instead of settling.
    for (let i = 0; i < n; i++) {
      const dLen = Math.sqrt(disp[i].x ** 2 + disp[i].y ** 2) || 0.01;
      const capped = Math.min(dLen, temperature);
      pos[i].x += (disp[i].x / dLen) * capped;
      pos[i].y += (disp[i].y / dLen) * capped;
    }
    temperature *= 0.95;
  }

  resolveOverlaps(pos, minSeparation);
  const centered = recenter(pos, centerX, centerY);
  return compactToTarget(centered, centerX, centerY, minSeparation, idealEdgeLength);
}

/** Push apart any pair still closer than `minSeparation` after the spring
 * simulation settles (its own equilibrium can still land there for a small,
 * densely-connected graph). A handful of relaxation passes rather than one
 * shot, since fixing one pair can nudge another back under the floor. */
function resolveOverlaps(pos, minSeparation) {
  for (let pass = 0; pass < 10; pass++) {
    let moved = false;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const dx = pos[j].x - pos[i].x;
        const dy = pos[j].y - pos[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        if (dist < minSeparation) {
          const push = (minSeparation - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          pos[i].x -= ux * push;
          pos[i].y -= uy * push;
          pos[j].x += ux * push;
          pos[j].y += uy * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

function recenter(pos, centerX, centerY) {
  const avgX = pos.reduce((sum, p) => sum + p.x, 0) / pos.length;
  const avgY = pos.reduce((sum, p) => sum + p.y, 0) / pos.length;
  return pos.map((p) => ({ id: p.id, x: p.x + (centerX - avgX), y: p.y + (centerY - avgY) }));
}

/**
 * Iteratively pulls the whole layout toward `(centerX, centerY)` when it
 * spread further than a "how big should this diagram reasonably be" budget
 * — the deterministic guarantee against far-flung, loosely-linked clusters
 * (the spring simulation's own gravity term helps but, being just another
 * force competing with however much repulsion a given graph shape happens
 * to generate, can't promise a bound on its own). A *single* uniform shrink
 * can't safely close that gap: a tightly-packed clique already sits right
 * at `minSeparation`, so scaling everything down by the same factor needed
 * to pull two loose clusters together would just as much crush the clique
 * below the floor. Shrinking a little at a time and re-running
 * `resolveOverlaps` after each step fixes that — a clique's pairs bounce
 * straight back to the floor (net no change there), while genuinely loose
 * space between clusters, having nothing to bounce back from, keeps
 * compacting step over step.
 */
function compactToTarget(pos, centerX, centerY, minSeparation, idealEdgeLength) {
  const n = pos.length;
  if (n < 2) return pos;

  // Same area-budget idea as `circleLayout`'s seed radius: enough room for
  // `n` states at roughly `idealEdgeLength` spacing, packed into a disk.
  const targetRadius = Math.max(minSeparation, (idealEdgeLength * Math.sqrt(n)) / 2);

  let current = pos.map((p) => ({ ...p }));
  for (let pass = 0; pass < 40; pass++) {
    let maxRadius = 0;
    for (const p of current) {
      const dx = p.x - centerX;
      const dy = p.y - centerY;
      maxRadius = Math.max(maxRadius, Math.sqrt(dx * dx + dy * dy));
    }
    if (maxRadius <= targetRadius) break;

    current = current.map((p) => ({
      id: p.id,
      x: centerX + (p.x - centerX) * 0.95,
      y: centerY + (p.y - centerY) * 0.95,
    }));
    resolveOverlaps(current, minSeparation);
  }
  return current;
}

/**
 * Horizontal, "layered"/Sugiyama-style layout: every state is placed in a
 * left-to-right column by its longest-path distance from `initialId`, so
 * the overall flow reads left-to-right even when the automaton has a cycle
 * — unlike `forceDirectedLayout`'s free-floating blob. A cycle is handled
 * by classifying edges via one DFS from `initialId`: whichever edge closes
 * a cycle (points back to a state still on the current DFS path) is
 * excluded only from the column assignment — same as a hand-drawn diagram, where
 * the "return" arm of a loop is naturally drawn curving backward rather
 * than reshuffling the whole layout around it. The edge itself is still
 * drawn normally; only its *layering* is ignored.
 *
 * Layering uses LONGEST path over the remaining (now acyclic) edges, not
 * shortest (BFS): a shortcut edge under shortest-path layering can land
 * entirely within one column, which is exactly the crossing this layout
 * exists to avoid. A state with no incoming (non-back) edges — including
 * one disconnected from `initialId` entirely, which this app already flags
 * as "unreachable" elsewhere — starts its own column-0 chain rather than
 * being dropped.
 * @param {{id:number}[]} states
 * @param {{from:number, to:number}[]} edges self-loops ignored, same convention as `forceDirectedLayout`
 * @param {number} initialId
 * @param {{centerX:number, centerY:number, columnSpacing?:number, rowSpacing?:number, edgeSpacing?:number}} opts
 *   `edgeSpacing`: gap between two adjacent row slots when either one is a
 *   dummy/routing waypoint rather than a real state (see below) — smaller
 *   than `rowSpacing` so a skip edge's own lane doesn't balloon the
 *   diagram's height just to keep it separate from real states.
 * @returns {{positions: {id:number, x:number, y:number}[], edgeWaypoints: Map<string, {x:number,y:number}[]>}}
 */
export function layeredLayout(
  states,
  edges,
  initialId,
  { centerX, centerY, columnSpacing = 160, rowSpacing = 90, edgeSpacing = 28 },
) {
  const n = states.length;
  if (n === 0) return { positions: [], edgeWaypoints: new Map() };
  if (n === 1) return { positions: [{ id: states[0].id, x: centerX, y: centerY }], edgeWaypoints: new Map() };

  const ids = states.map((s) => s.id);
  const idSet = new Set(ids);
  const rawAdj = new Map(ids.map((id) => [id, []]));
  for (const e of edges) {
    if (e.from === e.to || !idSet.has(e.from) || !idSet.has(e.to)) continue;
    rawAdj.get(e.from).push(e.to);
  }

  // One iterative (explicit stack) 3-color DFS, `initialId` visited first so
  // its own component's cycles get broken relative to it — this app's other
  // from-scratch graph traversals (Tarjan's SCC in `engine/fa.rs`) avoid
  // recursion the same way: a long chain of states must never risk blowing
  // the JS stack. Every tree/forward/cross edge (destination UNVISITED or
  // already DONE) is kept for layering; only a true back edge (destination
  // still IN_PROGRESS, i.e. an ancestor on the current path) is dropped.
  const UNVISITED = 0;
  const IN_PROGRESS = 1;
  const DONE = 2;
  const color = new Map(ids.map((id) => [id, UNVISITED]));
  const forwardAdj = new Map(ids.map((id) => [id, []]));
  const inDegree = new Map(ids.map((id) => [id, 0]));
  const visitStarts = idSet.has(initialId) ? [initialId, ...ids] : ids;
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
      if (color.get(neighbor) === IN_PROGRESS) continue; // back edge: skip for layering
      forwardAdj.get(frame.id).push(neighbor);
      inDegree.set(neighbor, inDegree.get(neighbor) + 1);
      if (color.get(neighbor) === UNVISITED) {
        color.set(neighbor, IN_PROGRESS);
        stack.push({ id: neighbor, next: 0 });
      }
    }
  }

  // Kahn's algorithm for a topological order over `forwardAdj` — guaranteed
  // acyclic (back edges were excluded above) — `initialId` dequeued first
  // among equally-ready (in-degree 0) roots so its own chain claims column 0
  // ahead of any other disconnected root.
  const remainingInDegree = new Map(inDegree);
  const queue = ids.filter((id) => remainingInDegree.get(id) === 0);
  queue.sort((a, b) => (a === initialId ? -1 : b === initialId ? 1 : 0));
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const next of forwardAdj.get(id)) {
      remainingInDegree.set(next, remainingInDegree.get(next) - 1);
      if (remainingInDegree.get(next) === 0) queue.push(next);
    }
  }

  const layer = new Map(ids.map((id) => [id, 0]));
  for (const id of order) {
    for (const next of forwardAdj.get(id)) {
      layer.set(next, Math.max(layer.get(next), layer.get(id) + 1));
    }
  }

  const byLayer = new Map();
  for (const id of ids) {
    const l = layer.get(id);
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l).push(id);
  }

  const realLayerNums = [...byLayer.keys()].sort((a, b) => a - b);
  const layerCount = realLayerNums[realLayerNums.length - 1] + 1;
  const startX = centerX - ((layerCount - 1) * columnSpacing) / 2;

  // Edge normalization (Sugiyama's own term): an edge spanning >=2 layers
  // gets a chain of dummy waypoints, one per intermediate layer it
  // crosses — every OTHER phase below (row ordering, coordinate
  // assignment) then treats a dummy exactly like a real state, so a skip
  // edge gets its own row/lane instead of being drawn as one plain line
  // straight across whatever real states happen to sit in between. This
  // is what actually fixes the reported "hasta 5 líneas superpuestas" —
  // without dummies, a distant `from`/`to` pair never even participates in
  // the barycenter sweep below (its two endpoints are never in adjacent
  // layers to each other), so nothing was ever pulling separate skip edges
  // apart. Uses `layer` (every state's already-resolved layer number)
  // rather than `forwardAdj`, so this applies uniformly whether the DFS
  // above classified this particular edge as forward or back — a
  // long-range back edge deserves its own lane too, same reasoning.
  const dummyChains = new Map(); // edgeKey (`${from}:${to}`) -> ordered dummy id[]
  for (const e of edges) {
    if (e.from === e.to || !idSet.has(e.from) || !idSet.has(e.to)) continue;
    const layerFrom = layer.get(e.from);
    const layerTo = layer.get(e.to);
    if (Math.abs(layerTo - layerFrom) < 2) continue;
    const step = layerTo > layerFrom ? 1 : -1;
    const chain = [];
    for (let l = layerFrom + step; l !== layerTo; l += step) {
      const dummyId = `dummy:${e.from}->${e.to}@${l}`;
      chain.push(dummyId);
      if (!byLayer.has(l)) byLayer.set(l, []);
      byLayer.get(l).push(dummyId);
    }
    dummyChains.set(`${e.from}:${e.to}`, chain);
  }
  const isDummyId = (id) => typeof id === "string";
  // Recomputed AFTER dummy insertion — a chain never reaches outside
  // [0, layerCount-1] (both endpoints already live in that range), so
  // `layerCount`/`startX` above stay correct; this just also picks up any
  // layer that had zero real states but now holds a dummy passing through.
  const layerNums = [...byLayer.keys()].sort((a, b) => a - b);

  // Barycenter/median sweep (Sugiyama's own row-ordering step, the same
  // idea Graphviz `dot` uses) — the column assignment above says nothing
  // about ROW order within a layer, so two branches sharing a column
  // otherwise just keep whatever order they happened to be declared in,
  // which is exactly what left a Thompson-construction-style diamond (a
  // parallel pair of states, or a state re-merging after a bypass) looking
  // arbitrarily staggered instead of reading as one clean shape. Row
  // adjacency deliberately uses the full (undirected) `edges` list, not
  // just `forwardAdj` — a back edge excluded from layering above (e.g. a
  // Kleene-star's loop-back) still pulls its row toward whatever it
  // connects to. A routed (>=2-layer) edge contributes its CHAIN links
  // (from<->dummy_1<->...<->to) instead of the raw far-apart pair — that
  // raw pair was never usable by the sweep anyway (its endpoints are never
  // in "the adjacent layer" to each other), so this only adds signal, it
  // never removes any real-state alignment that existed before.
  const adjAll = new Map();
  for (const l of layerNums) {
    for (const id of byLayer.get(l)) adjAll.set(id, new Set());
  }
  for (const e of edges) {
    if (e.from === e.to || !idSet.has(e.from) || !idSet.has(e.to)) continue;
    const chain = dummyChains.get(`${e.from}:${e.to}`);
    const sequence = chain && chain.length ? [e.from, ...chain, e.to] : [e.from, e.to];
    for (let i = 0; i < sequence.length - 1; i++) {
      adjAll.get(sequence[i]).add(sequence[i + 1]);
      adjAll.get(sequence[i + 1]).add(sequence[i]);
    }
  }

  const rowOrder = new Map(layerNums.map((l) => [l, [...byLayer.get(l)]]));
  const position = new Map();
  for (const l of layerNums) {
    rowOrder.get(l).forEach((id, i) => position.set(id, { layer: l, index: i }));
  }

  const SWEEPS = 4;
  for (let pass = 0; pass < SWEEPS; pass++) {
    const forward = pass % 2 === 0;
    const sweepOrder = forward ? layerNums : [...layerNums].reverse();
    for (const l of sweepOrder) {
      const currentIds = rowOrder.get(l);
      if (currentIds.length < 2) continue;
      const adjacentLayer = forward ? l - 1 : l + 1;
      const withBarycenter = currentIds.map((id, i) => {
        const neighborRows = [];
        for (const neighbor of adjAll.get(id)) {
          const pos = position.get(neighbor);
          if (pos && pos.layer === adjacentLayer) neighborRows.push(pos.index);
        }
        // No neighbor in the adjacent layer this pass looks at (a dead end,
        // or nothing placed there yet): keep this state's own current index
        // as its sort key, so it holds its relative spot instead of every
        // unaligned state collapsing to the front together.
        const barycenter = neighborRows.length
          ? neighborRows.reduce((sum, r) => sum + r, 0) / neighborRows.length
          : i;
        return { id, i, barycenter };
      });
      withBarycenter.sort((a, b) => a.barycenter - b.barycenter || a.i - b.i);
      const newOrder = withBarycenter.map((w) => w.id);
      rowOrder.set(l, newOrder);
      newOrder.forEach((id, i) => position.set(id, { layer: l, index: i }));
    }
  }

  // Coordinate assignment: a running cumulative offset rather than a flat
  // `i * rowSpacing`, since adjacent slots no longer share one uniform
  // gap — two real states keep `rowSpacing`, but a gap touching a dummy
  // (dagre's "edgeSep", vs. "nodeSep" for real states) uses the tighter
  // `edgeSpacing`, so a skip edge's own routing lane doesn't inflate the
  // whole diagram's height just to stay separate from real content.
  const positions = [];
  const dummyPositions = new Map();
  for (const l of layerNums) {
    const idsInLayer = rowOrder.get(l);
    const x = startX + l * columnSpacing;
    const cumulative = [0];
    for (let i = 1; i < idsInLayer.length; i++) {
      const gap = isDummyId(idsInLayer[i - 1]) || isDummyId(idsInLayer[i]) ? edgeSpacing : rowSpacing;
      cumulative.push(cumulative[i - 1] + gap);
    }
    const startY = centerY - cumulative[cumulative.length - 1] / 2;
    idsInLayer.forEach((id, i) => {
      const y = startY + cumulative[i];
      if (isDummyId(id)) dummyPositions.set(id, { x, y });
      else positions.push({ id, x, y });
    });
  }

  const edgeWaypoints = new Map();
  for (const [key, chain] of dummyChains) {
    edgeWaypoints.set(key, chain.map((dummyId) => dummyPositions.get(dummyId)));
  }

  return { positions, edgeWaypoints };
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

/**
 * A smooth curve through an ordered point sequence (a routed skip edge's
 * dummy-node waypoints, `from`/`to` already trimmed to their circle
 * boundaries by the caller) — a clamped Catmull-Rom spline converted to
 * cubic-bezier segments, so a multi-waypoint route reads as one continuous
 * curve (matching `curvedEdgePath`'s arcs) instead of sharp angular joints
 * at each dummy node. "Clamped" means the sequence's own first/last point
 * stands in for the missing neighbor a real Catmull-Rom tangent would need
 * at the ends, rather than extrapolating a virtual one — simple and correct
 * for the short chains (3-5 points) a routed edge actually produces.
 * @param {{x:number,y:number}[]} points already-trimmed, >= 2 points
 * @param {number} [labelGap]
 * @returns {{d: string, labelX: number, labelY: number}}
 */
export function routedEdgePath(points, labelGap = 12) {
  const n = points.length;
  if (n === 2) {
    const [p0, p1] = points;
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    const ddx = p1.x - p0.x;
    const ddy = p1.y - p0.y;
    const dist = Math.hypot(ddx, ddy) || 1;
    return {
      d: `M${p0.x},${p0.y} L${p1.x},${p1.y}`,
      labelX: mx + (-ddy / dist) * labelGap,
      labelY: my + (ddx / dist) * labelGap,
    };
  }

  let d = `M${points[0].x},${points[0].y}`;
  const segments = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? points[i + 1];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
    segments.push({ start: p1, c1, c2, end: p2 });
  }

  // Middle segment's own true midpoint (same "close enough" reasoning as
  // the rest of this route: segments are short and similar in length, not
  // worth true arc-length parameterization) — direction for the label
  // offset comes from that segment's own endpoints (a secant), same
  // convention the rest of this file already uses for a straight/curved
  // edge's label push.
  const midIndex = Math.min(Math.floor((n - 1) / 2), segments.length - 1);
  const mid = segments[midIndex];
  const midpoint = cubicMidpoint(mid.start, mid.c1, mid.c2, mid.end);
  const ddx = mid.end.x - mid.start.x;
  const ddy = mid.end.y - mid.start.y;
  const dist = Math.hypot(ddx, ddy) || 1;
  return {
    d,
    labelX: midpoint.x + (-ddy / dist) * labelGap,
    labelY: midpoint.y + (ddx / dist) * labelGap,
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
