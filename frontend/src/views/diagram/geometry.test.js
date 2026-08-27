import { describe, expect, it } from "vitest";
import {
  circleLayout,
  curvedEdgePath,
  edgeEndpoints,
  forceDirectedLayout,
  layeredLayout,
  nextStateLabel,
  preferredLoopAngle,
  selfLoopPath,
  statusSummary,
} from "./geometry.js";

describe("nextStateLabel", () => {
  it("returns q0 for an empty document", () => {
    expect(nextStateLabel([])).toBe("q0");
  });

  it("returns the smallest unused qN", () => {
    expect(nextStateLabel([{ label: "q0" }, { label: "q1" }])).toBe("q2");
  });

  it("fills gaps rather than always appending", () => {
    expect(nextStateLabel([{ label: "q0" }, { label: "q2" }])).toBe("q1");
  });

  it("ignores non-qN-shaped labels", () => {
    expect(nextStateLabel([{ label: "start" }, { label: "q0" }])).toBe("q1");
  });
});

describe("circleLayout", () => {
  it("returns one position per state, evenly spaced on a circle", () => {
    const states = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const positions = circleLayout(states, { centerX: 100, centerY: 100, radius: 50 });

    expect(positions).toHaveLength(4);
    for (const p of positions) {
      const dx = p.x - 100;
      const dy = p.y - 100;
      expect(Math.sqrt(dx * dx + dy * dy)).toBeCloseTo(50, 5);
    }
    // Opposite corners of a 4-point circle are 2*radius apart.
    const dx = positions[0].x - positions[2].x;
    const dy = positions[0].y - positions[2].y;
    expect(Math.sqrt(dx * dx + dy * dy)).toBeCloseTo(100, 5);
  });

  it("returns an empty array for zero states", () => {
    expect(circleLayout([], { centerX: 0, centerY: 0, radius: 10 })).toEqual([]);
  });
});

describe("forceDirectedLayout", () => {
  it("returns an empty array for zero states", () => {
    expect(forceDirectedLayout([], [], { centerX: 0, centerY: 0 })).toEqual([]);
  });

  it("puts a single state at the center", () => {
    const positions = forceDirectedLayout([{ id: 1 }], [], { centerX: 100, centerY: 50 });
    expect(positions).toEqual([{ id: 1, x: 100, y: 50 }]);
  });

  it("never leaves two states closer than minSeparation, even fully connected", () => {
    const states = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
    const edges = [];
    for (const a of states) for (const b of states) if (a.id < b.id) edges.push({ from: a.id, to: b.id });
    const minSeparation = 70;
    const positions = forceDirectedLayout(states, edges, { centerX: 300, centerY: 200, minSeparation });
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThanOrEqual(minSeparation - 0.5);
      }
    }
  });

  it("ignores self-loops when pulling states together", () => {
    const states = [{ id: 1 }, { id: 2 }];
    const positions = forceDirectedLayout(states, [{ from: 1, to: 1 }], { centerX: 0, centerY: 0 });
    expect(positions).toHaveLength(2);
    expect(Number.isFinite(positions[0].x)).toBe(true);
    expect(Number.isFinite(positions[1].x)).toBe(true);
  });

  it("pulls a connected pair closer together than two disconnected states given the same state count", () => {
    // Star graph: state 1 connects to everything else, 4 is only linked
    // through that hub — the directly-connected pair (1,2) should end up
    // closer than the two-hop pair (2,4).
    const states = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const edges = [
      { from: 1, to: 2 },
      { from: 1, to: 3 },
      { from: 1, to: 4 },
    ];
    const positions = forceDirectedLayout(states, edges, { centerX: 300, centerY: 200 });
    const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    const byId = new Map(positions.map((p) => [p.id, p]));
    const directPairDist = dist(byId.get(1), byId.get(2));
    const twoHopDist = dist(byId.get(2), byId.get(4));
    expect(directPairDist).toBeLessThan(twoHopDist);
  });

  it("is deterministic for the same input", () => {
    const states = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const edges = [{ from: 1, to: 2 }];
    const a = forceDirectedLayout(states, edges, { centerX: 300, centerY: 200 });
    const b = forceDirectedLayout(states, edges, { centerX: 300, centerY: 200 });
    expect(a).toEqual(b);
  });

  it("keeps two loosely-linked clusters from drifting apart without bound (regression: a real 58-state NFA rendered as far-flung islands joined by long crossing edges)", () => {
    // Two 10-state cliques joined by a single bridge edge: repulsion between
    // the two dense clusters has nothing pulling them back together except
    // that one bridge, which is exactly the shape that made whole clusters
    // fly far apart before a centering force was added.
    const clusterA = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const clusterB = Array.from({ length: 10 }, (_, i) => ({ id: 10 + i }));
    const states = [...clusterA, ...clusterB];
    const edges = [];
    for (const a of clusterA) for (const b of clusterA) if (a.id < b.id) edges.push({ from: a.id, to: b.id });
    for (const a of clusterB) for (const b of clusterB) if (a.id < b.id) edges.push({ from: a.id, to: b.id });
    edges.push({ from: 0, to: 10 }); // the single bridge

    const positions = forceDirectedLayout(states, edges, { centerX: 300, centerY: 200 });
    let maxDist = 0;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy));
      }
    }
    // 20 states at a ~130px ideal edge length should span at most a few
    // hundred px across, not the thousands a purely repulsive, unbounded
    // layout would produce.
    expect(maxDist).toBeLessThan(900);
  });
});

describe("layeredLayout", () => {
  it("returns [] for no states, and centers a single state", () => {
    expect(layeredLayout([], [], 1, { centerX: 0, centerY: 0 })).toEqual([]);
    const positions = layeredLayout([{ id: 1 }], [], 1, { centerX: 100, centerY: 50 });
    expect(positions).toEqual([{ id: 1, x: 100, y: 50 }]);
  });

  it("places a linear chain in strictly increasing x order, one per column", () => {
    const states = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const edges = [{ from: 1, to: 2 }, { from: 2, to: 3 }];
    const positions = layeredLayout(states, edges, 1, { centerX: 0, centerY: 0 });
    const byId = new Map(positions.map((p) => [p.id, p]));
    expect(byId.get(1).x).toBeLessThan(byId.get(2).x);
    expect(byId.get(2).x).toBeLessThan(byId.get(3).x);
    // A straight chain has no branching, so every state shares one row.
    expect(byId.get(1).y).toBe(byId.get(2).y);
    expect(byId.get(2).y).toBe(byId.get(3).y);
  });

  it("uses the LONGEST path for layering, so a shortcut edge still points strictly forward", () => {
    // 1 -> 2 -> 3, plus a shortcut 1 -> 3: shortest-path layering would put
    // 3 one column after 1 (via the shortcut) — sharing 2's column and
    // making the 2->3 edge point backward. Longest-path layering must place
    // 3 strictly after 2 instead.
    const states = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const edges = [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 1, to: 3 }];
    const positions = layeredLayout(states, edges, 1, { centerX: 0, centerY: 0 });
    const byId = new Map(positions.map((p) => [p.id, p]));
    expect(byId.get(3).x).toBeGreaterThan(byId.get(2).x);
  });

  it("stacks branches sharing a column across distinct rows, not on top of each other", () => {
    const states = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const edges = [{ from: 1, to: 2 }, { from: 1, to: 3 }];
    const positions = layeredLayout(states, edges, 1, { centerX: 0, centerY: 0 });
    const byId = new Map(positions.map((p) => [p.id, p]));
    expect(byId.get(2).x).toBe(byId.get(3).x);
    expect(byId.get(2).y).not.toBe(byId.get(3).y);
  });

  it("gives a state disconnected from the initial state its own column-0 row instead of dropping it", () => {
    const states = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const edges = [{ from: 2, to: 3 }]; // 1 is the initial state but isolated
    const positions = layeredLayout(states, edges, 1, { centerX: 0, centerY: 0 });
    expect(positions).toHaveLength(3);
    const byId = new Map(positions.map((p) => [p.id, p]));
    expect(byId.get(1).x).toBe(byId.get(2).x);
    expect(byId.get(3).x).toBeGreaterThan(byId.get(2).x);
  });

  it("still lays out left-to-right when the automaton has a cycle, by treating whichever edge closes it as a backward exception (not a column-breaking crossing)", () => {
    // A direct 2-cycle: 1 -> 2 -> 1. DFS from 1 visits 2 via the forward
    // edge; 2's edge back to 1 is the one closing the cycle, so it's
    // excluded from layering only — 1 stays column 0, 2 column 1.
    const states = [{ id: 1 }, { id: 2 }];
    const edges = [{ from: 1, to: 2 }, { from: 2, to: 1 }];
    const positions = layeredLayout(states, edges, 1, { centerX: 0, centerY: 0 });
    const byId = new Map(positions.map((p) => [p.id, p]));
    expect(byId.get(2).x).toBeGreaterThan(byId.get(1).x);
  });

  it("reproduces the reported a*b-regex shape: a 2-cycle midway through an otherwise linear chain still reads left-to-right end to end", () => {
    // t2 (initial) -eps-> t0 -a-> t1 -eps-> t0 (cycle), t1 -eps-> t3,
    // t2 -eps-> t3 (direct shortcut), t3 -eps-> t4 -b-> t5.
    const states = [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
    const edges = [
      { from: 2, to: 0 },
      { from: 0, to: 1 },
      { from: 1, to: 0 },
      { from: 1, to: 3 },
      { from: 2, to: 3 },
      { from: 3, to: 4 },
      { from: 4, to: 5 },
    ];
    const positions = layeredLayout(states, edges, 2, { centerX: 0, centerY: 0 });
    const byId = new Map(positions.map((p) => [p.id, p]));
    expect(byId.get(2).x).toBeLessThan(byId.get(0).x);
    expect(byId.get(0).x).toBeLessThan(byId.get(1).x);
    expect(byId.get(1).x).toBeLessThan(byId.get(3).x);
    expect(byId.get(3).x).toBeLessThan(byId.get(4).x);
    expect(byId.get(4).x).toBeLessThan(byId.get(5).x);
  });

  it("ignores self-loops when computing columns", () => {
    const states = [{ id: 1 }, { id: 2 }];
    const edges = [{ from: 1, to: 1 }, { from: 1, to: 2 }];
    const positions = layeredLayout(states, edges, 1, { centerX: 0, centerY: 0 });
    const byId = new Map(positions.map((p) => [p.id, p]));
    expect(byId.get(2).x).toBeGreaterThan(byId.get(1).x);
  });
});

describe("edgeEndpoints", () => {
  const R = 20;

  it("trims a straight edge to the boundary of both state circles", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 0 };
    const { x1, y1, x2, y2 } = edgeEndpoints(from, to, R);

    expect(x1).toBeCloseTo(20, 5);
    expect(y1).toBeCloseTo(0, 5);
    expect(x2).toBeCloseTo(80, 5);
    expect(y2).toBeCloseTo(0, 5);
  });

  it("returns a self-loop descriptor when from === to", () => {
    const state = { x: 50, y: 50 };
    const loop = edgeEndpoints(state, state, R);
    expect(loop.selfLoop).toBe(true);
  });
});

describe("preferredLoopAngle", () => {
  it("defaults to straight up when there are no neighbors", () => {
    expect(preferredLoopAngle({ x: 0, y: 0 }, [])).toBe(-90);
  });

  it("points away from a single neighbor directly to the right", () => {
    const angle = preferredLoopAngle({ x: 0, y: 0 }, [{ x: 100, y: 0 }]);
    // neighbor is at 0°, so "away" is the 180°/-180° boundary — atan2 can
    // land on either sign of it depending on floating-point zero, both mean
    // the same direction ("left").
    expect(Math.abs(angle)).toBeCloseTo(180, 5);
  });

  it("points away from the average direction of several neighbors", () => {
    // Two neighbors both below the state (90°): away from their average is -90° (up).
    const angle = preferredLoopAngle({ x: 0, y: 0 }, [
      { x: -10, y: 50 },
      { x: 10, y: 50 },
    ]);
    expect(angle).toBeCloseTo(-90, 0);
  });
});

describe("selfLoopPath", () => {
  const R = 20;

  it("starts and ends exactly on the circle boundary", () => {
    const state = { x: 50, y: 50 };
    const { d } = selfLoopPath(state, R, { angleDeg: -90 });
    const [start, , , end] = d.match(/-?\d+(\.\d+)?/g).reduce((pairs, n, i, arr) => {
      if (i % 2 === 0) pairs.push([Number(n), Number(arr[i + 1])]);
      return pairs;
    }, []);
    for (const [x, y] of [start, end]) {
      const dist = Math.hypot(x - state.x, y - state.y);
      expect(dist).toBeCloseTo(R, 5);
    }
  });

  it("puts the label on the curve's true midpoint, not a control point", () => {
    const state = { x: 100, y: 100 };
    const { labelX, labelY } = selfLoopPath(state, R, { angleDeg: -90, reach: 40 });
    // The label must sit further from the state than the radius (it's outside
    // the circle, on the bulge) but well short of the full "reach" distance
    // past it (it must not sit out at the control-point distance either).
    const dist = Math.hypot(labelX - state.x, labelY - state.y);
    expect(dist).toBeGreaterThan(R);
    expect(dist).toBeLessThan(R + 40);
  });

  it("labelGap pushes the label further from the curve than 0 would (bug: label sat directly on the loop)", () => {
    const state = { x: 100, y: 100 };
    const onCurve = selfLoopPath(state, R, { angleDeg: -90, reach: 40, labelGap: 0 });
    const withGap = selfLoopPath(state, R, { angleDeg: -90, reach: 40, labelGap: 12 });
    const onCurveDist = Math.hypot(onCurve.labelX - state.x, onCurve.labelY - state.y);
    const withGapDist = Math.hypot(withGap.labelX - state.x, withGap.labelY - state.y);
    expect(withGapDist).toBeGreaterThan(onCurveDist);
  });

  it("a longer reach makes a longer, less stubby loop", () => {
    const state = { x: 0, y: 0 };
    const short = selfLoopPath(state, R, { angleDeg: -90, reach: 20 });
    const long = selfLoopPath(state, R, { angleDeg: -90, reach: 60 });
    const shortDist = Math.hypot(short.labelX - state.x, short.labelY - state.y);
    const longDist = Math.hypot(long.labelX - state.x, long.labelY - state.y);
    expect(longDist).toBeGreaterThan(shortDist);
  });
});

describe("curvedEdgePath", () => {
  const R = 20;

  it("bulges to opposite sides for side=1 vs side=-1, so a bidirectional pair doesn't overlap", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 200, y: 0 };
    const right = curvedEdgePath(from, to, R, 1);
    const left = curvedEdgePath(from, to, R, -1);
    // The line from->to is horizontal, so the two arcs must bulge to
    // opposite sides in y (one above, one below).
    expect(Math.sign(right.labelY)).not.toBe(Math.sign(left.labelY));
  });

  it("trims both endpoints to the circle boundary", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 200, y: 0 };
    const { d } = curvedEdgePath(from, to, R, 1);
    const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
    const [x0, y0] = nums;
    const [x1, y1] = nums.slice(-2);
    expect(Math.hypot(x0 - from.x, y0 - from.y)).toBeCloseTo(R, 5);
    expect(Math.hypot(x1 - to.x, y1 - to.y)).toBeCloseTo(R, 5);
  });

  it("label sits on the curve's true midpoint, roughly between the two states", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 200, y: 0 };
    const { labelX } = curvedEdgePath(from, to, R, 1, 36);
    expect(labelX).toBeGreaterThan(50);
    expect(labelX).toBeLessThan(150);
  });

  it("pushes the label further off the curve than a straight midpoint would sit (bug: label sat directly on the line)", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 200, y: 0 };
    const onCurve = curvedEdgePath(from, to, R, 1, 36, 0);
    const withGap = curvedEdgePath(from, to, R, 1, 36, 12);
    expect(withGap.labelY).toBeGreaterThan(onCurve.labelY);
  });

  it("a real bidirectional pair (A->B then B->A, swapped from/to) still bulges to opposite sides", () => {
    // Matches DiagramView._renderCanvas's actual call convention: each edge
    // keeps its own real from/to (so the arrowhead points the right way),
    // and `side` is picked from `edge.from < edge.to`. A->B (id 1->2) gets
    // side=1; B->A (id 2->1) gets side=-1 — with swapped from/to on top of
    // that swapped side.
    const a = { x: 0, y: 0 };
    const b = { x: 200, y: 0 };
    const aToB = curvedEdgePath(a, b, R, 1);
    const bToA = curvedEdgePath(b, a, R, -1);
    expect(Math.sign(aToB.labelY)).not.toBe(Math.sign(bToA.labelY));
    expect(Math.sign(aToB.labelY)).not.toBe(0);
  });
});

describe("statusSummary", () => {
  it("reports classification, state/transition counts and alphabet size", () => {
    const summary = statusSummary({
      states: [{ id: 1 }, { id: 2 }],
      edges: [
        { from: 1, to: 2, symbols: ["a", "b"] },
        { from: 2, to: 2, symbols: ["c"] },
      ],
      derived: { classification: "Nfa", alphabet: ["a", "b", "c"], unreachable: [2] },
    });

    expect(summary).toEqual({
      classification: "Nfa",
      stateCount: 2,
      transitionCount: 3, // one per (edge, symbol) pair, matching kflap's delta-row convention
      alphabetSize: 3,
      unreachableCount: 1,
    });
  });

  it("counts an epsilon-only edge as one transition", () => {
    const summary = statusSummary({
      states: [{ id: 1 }, { id: 2 }],
      edges: [{ from: 1, to: 2, epsilon: true, symbols: [] }],
      derived: { classification: "Nfa", alphabet: [], unreachable: [] },
    });
    expect(summary.transitionCount).toBe(1);
  });
});
