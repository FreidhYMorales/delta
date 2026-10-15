import { describe, expect, it } from "vitest";
import {
  circleLayout,
  curvedEdgePath,
  edgeEndpoints,
  estimateLabelSize,
  layeredLayout,
  nextStateLabel,
  preferredLoopAngle,
  resolveLabelOverlaps,
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

describe("layeredLayout", () => {
  it("returns [] for no states, and centers a single state", () => {
    expect(layeredLayout([], [], 1, { centerX: 0, centerY: 0 }).positions).toEqual([]);
    const { positions } = layeredLayout([{ id: 1 }], [], 1, { centerX: 100, centerY: 50 });
    expect(positions).toEqual([{ id: 1, x: 100, y: 50 }]);
  });

  it("places a linear chain in strictly increasing x order, one per column", () => {
    const states = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const edges = [{ from: 1, to: 2 }, { from: 2, to: 3 }];
    const { positions } = layeredLayout(states, edges, 1, { centerX: 0, centerY: 0 });
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
    const { positions } = layeredLayout(states, edges, 1, { centerX: 0, centerY: 0 });
    const byId = new Map(positions.map((p) => [p.id, p]));
    expect(byId.get(3).x).toBeGreaterThan(byId.get(2).x);
  });

  it("stacks branches sharing a column across distinct rows, not on top of each other", () => {
    const states = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const edges = [{ from: 1, to: 2 }, { from: 1, to: 3 }];
    const { positions } = layeredLayout(states, edges, 1, { centerX: 0, centerY: 0 });
    const byId = new Map(positions.map((p) => [p.id, p]));
    expect(byId.get(2).x).toBe(byId.get(3).x);
    expect(byId.get(2).y).not.toBe(byId.get(3).y);
  });

  it("gives a state disconnected from the initial state its own column-0 row instead of dropping it", () => {
    const states = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const edges = [{ from: 2, to: 3 }]; // 1 is the initial state but isolated
    const { positions } = layeredLayout(states, edges, 1, { centerX: 0, centerY: 0 });
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
    const { positions } = layeredLayout(states, edges, 1, { centerX: 0, centerY: 0 });
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
    const { positions } = layeredLayout(states, edges, 2, { centerX: 0, centerY: 0 });
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
    const { positions } = layeredLayout(states, edges, 1, { centerX: 0, centerY: 0 });
    const byId = new Map(positions.map((p) => [p.id, p]));
    expect(byId.get(2).x).toBeGreaterThan(byId.get(1).x);
  });

  it("aligns a diamond's parallel branches by their own connections, not plain insertion order", () => {
    // 1 -> 2, 1 -> 3 fan out (tied so far); 3 -> 4, 2 -> 5 cross-wire the
    // fan-back-in so insertion order (states declared as ...,4,5) and
    // connection order disagree — a real barycenter sweep must carry 2/5's
    // and 3/4's shared branch alignment through, not just keep declaration
    // order.
    const states = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
    const edges = [
      { from: 1, to: 2 },
      { from: 1, to: 3 },
      { from: 3, to: 4 },
      { from: 2, to: 5 },
    ];
    const { positions } = layeredLayout(states, edges, 1, { centerX: 0, centerY: 0 });
    const byId = new Map(positions.map((p) => [p.id, p]));
    expect(byId.get(2).y).toBeLessThan(byId.get(3).y);
    // 5 hangs off 2, 4 hangs off 3 — insertion order alone (4 declared
    // before 5) would put 4 first; the sweep must instead follow 2/5's and
    // 3/4's shared branch.
    expect(byId.get(5).y).toBeLessThan(byId.get(4).y);
  });

  it("keeps a dead-end branch's relative position instead of collapsing every unaligned state to the front", () => {
    // 1 fans out to 2, 3, 4 (tied, no signal yet); only 4 continues on to
    // 6. On the sweep's backward pass, 2 and 3 are both dead ends (no
    // successor to align with) — 3 must stay behind 4 once 4's real
    // connection pulls it forward, not tie with 2 at the front just
    // because both lack a signal.
    const states = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 6 }];
    const edges = [
      { from: 1, to: 2 },
      { from: 1, to: 3 },
      { from: 1, to: 4 },
      { from: 4, to: 6 },
    ];
    const { positions } = layeredLayout(states, edges, 1, { centerX: 0, centerY: 0 });
    const byId = new Map(positions.map((p) => [p.id, p]));
    expect(byId.get(4).y).toBeLessThan(byId.get(3).y);
  });

  it("returns positions only — every edge is drawn straight, so there are no waypoints to go stale on a later drag", () => {
    const states = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const edges = [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }, { from: 1, to: 4 }];
    const result = layeredLayout(states, edges, 1, { centerX: 0, centerY: 0 });
    expect(Object.keys(result)).toEqual(["positions"]);
  });

  it("lays out without an initial state (every root starts its own column-0 chain)", () => {
    const states = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const edges = [{ from: 1, to: 2 }, { from: 2, to: 3 }];
    const { positions } = layeredLayout(states, edges, undefined, { centerX: 0, centerY: 0 });
    const byId = new Map(positions.map((p) => [p.id, p]));
    expect(byId.get(1).x).toBeLessThan(byId.get(2).x);
    expect(byId.get(2).x).toBeLessThan(byId.get(3).x);
  });

  describe("never lets a straight edge run over a state or another edge", () => {
    const STATE_CLEARANCE = 26; // state radius (20) plus a visible margin

    function distanceToSegment(p, a, b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    }

    function uniquePairs(edges) {
      const seen = new Map();
      for (const e of edges) {
        if (e.from === e.to) continue;
        const key = e.from < e.to ? `${e.from}:${e.to}` : `${e.to}:${e.from}`;
        seen.set(key, [Math.min(e.from, e.to), Math.max(e.from, e.to)]);
      }
      return [...seen.values()];
    }

    function collinearOverlap(a, b, c, d) {
      const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      if (Math.abs(cross(a, b, c)) > 1e-6 || Math.abs(cross(a, b, d)) > 1e-6) return false;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const project = (p) => ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len;
      const lo = Math.max(0, Math.min(project(c), project(d)));
      const hi = Math.min(len, Math.max(project(c), project(d)));
      return hi - lo > 1e-6;
    }

    function assertReadable(states, edges, initialId) {
      const { positions } = layeredLayout(states, edges, initialId, { centerX: 0, centerY: 0 });
      const byId = new Map(positions.map((p) => [p.id, p]));
      const pairs = uniquePairs(edges);

      for (const [a, b] of pairs) {
        for (const s of states) {
          if (s.id === a || s.id === b) continue;
          const d = distanceToSegment(byId.get(s.id), byId.get(a), byId.get(b));
          expect(d, `edge ${a}-${b} runs over state ${s.id}`).toBeGreaterThanOrEqual(STATE_CLEARANCE);
        }
      }
      for (let i = 0; i < pairs.length; i++) {
        for (let j = i + 1; j < pairs.length; j++) {
          const [a, b] = pairs[i];
          const [c, d] = pairs[j];
          const overlap = collinearOverlap(byId.get(a), byId.get(b), byId.get(c), byId.get(d));
          expect(overlap, `edges ${a}-${b} and ${c}-${d} overlap`).toBe(false);
        }
      }
      return byId;
    }

    it("a chain closed by a long back edge (the back edge used to run straight over every middle state)", () => {
      const states = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
      const edges = [
        { from: 1, to: 2 },
        { from: 2, to: 3 },
        { from: 3, to: 4 },
        { from: 4, to: 5 },
        { from: 5, to: 1 },
      ];
      assertReadable(states, edges, 1);
    });

    it("several skip edges over the same chain", () => {
      const states = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
      const edges = [
        { from: 1, to: 2 },
        { from: 2, to: 3 },
        { from: 3, to: 4 },
        { from: 4, to: 5 },
        { from: 1, to: 3 },
        { from: 1, to: 4 },
        { from: 2, to: 5 },
        { from: 1, to: 5 },
      ];
      assertReadable(states, edges, 1);
    });

    it("the (a|b)*abb DFA, with its back edges and a bidirectional pair", () => {
      const states = [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }];
      const edges = [
        { from: 0, to: 1 },
        { from: 0, to: 0 },
        { from: 1, to: 1 },
        { from: 1, to: 2 },
        { from: 2, to: 1 },
        { from: 2, to: 3 },
        { from: 3, to: 1 },
        { from: 3, to: 0 },
      ];
      assertReadable(states, edges, 0);
    });

    it("the Thompson NFA for (a|b)*abb", () => {
      const states = Array.from({ length: 11 }, (_, id) => ({ id }));
      const edges = [
        { from: 0, to: 1 },
        { from: 0, to: 7 },
        { from: 1, to: 2 },
        { from: 1, to: 4 },
        { from: 2, to: 3 },
        { from: 4, to: 5 },
        { from: 3, to: 6 },
        { from: 5, to: 6 },
        { from: 6, to: 1 },
        { from: 6, to: 7 },
        { from: 7, to: 8 },
        { from: 8, to: 9 },
        { from: 9, to: 10 },
      ];
      assertReadable(states, edges, 0);
    });

    it("a dense pseudo-random 14-state automaton", () => {
      let seed = 7;
      const rand = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      const states = Array.from({ length: 14 }, (_, id) => ({ id }));
      const edges = [];
      for (let i = 0; i < 13; i++) edges.push({ from: i, to: i + 1 });
      for (let k = 0; k < 16; k++) {
        edges.push({ from: Math.floor(rand() * 14), to: Math.floor(rand() * 14) });
      }
      assertReadable(states, edges, 0);
    });

    it("keeps every state on a grid of columns and rows", () => {
      const states = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
      const edges = [
        { from: 1, to: 2 },
        { from: 1, to: 3 },
        { from: 2, to: 4 },
        { from: 3, to: 4 },
        { from: 4, to: 5 },
        { from: 5, to: 1 },
      ];
      const byId = assertReadable(states, edges, 1);
      const columnSpacing = 160;
      const rowSpacing = 90;
      const origin = byId.get(1);
      for (const p of byId.values()) {
        expect(Math.abs(((p.x - origin.x) / columnSpacing) % 1)).toBeCloseTo(0, 6);
        expect(Math.abs(((p.y - origin.y) / (rowSpacing / 2)) % 1)).toBeCloseTo(0, 6);
      }
    });
  });

  describe("draws Thompson-style shapes: a straight spine with symmetric branches", () => {
    const layout = (n, pairs, initialId = 0) => {
      const states = Array.from({ length: n }, (_, id) => ({ id }));
      const edges = pairs.map(([from, to]) => ({ from, to }));
      const { positions } = layeredLayout(states, edges, initialId, { centerX: 0, centerY: 0 });
      return new Map(positions.map((p) => [p.id, p]));
    };

    it("a union (a|b) is a symmetric diamond: fork and join centered between both branches", () => {
      // 0 -> 1 forks to 2/4, 2 -> 3, 4 -> 5, both join at 6 -> 7.
      const at = layout(8, [[0, 1], [1, 2], [1, 4], [2, 3], [4, 5], [3, 6], [5, 6], [6, 7]]);
      expect(at.get(2).y).toBe(at.get(3).y);
      expect(at.get(4).y).toBe(at.get(5).y);
      expect(at.get(2).y).not.toBe(at.get(4).y);
      expect(at.get(1).y).toBeCloseTo((at.get(2).y + at.get(4).y) / 2, 6);
      expect(at.get(6).y).toBeCloseTo((at.get(3).y + at.get(5).y) / 2, 6);
      // The spine stays one straight row.
      for (const id of [0, 1, 6, 7]) expect(at.get(id).y).toBe(at.get(0).y);
    });

    it("a star (a|b)* around a union keeps fork, join and the rest of the spine on one row", () => {
      // t6 -> t4, t4 forks to t0/t2, t0 -> t1, t2 -> t3, join at t5,
      // t5 -> t4 loops back, t4 -> t5 bypasses, t5 -> t7 -> t8.
      const at = layout(9, [[6, 4], [4, 0], [4, 2], [0, 1], [2, 3], [1, 5], [3, 5], [5, 4], [4, 5], [5, 7], [7, 8]], 6);
      for (const id of [4, 5, 7, 8]) expect(at.get(id).y).toBe(at.get(6).y);
      expect(at.get(4).y).toBeCloseTo((at.get(0).y + at.get(2).y) / 2, 6);
      expect(at.get(0).y).toBe(at.get(1).y);
      expect(at.get(2).y).toBe(at.get(3).y);
    });

    it("a DFA fanning out to two states sits centered between them", () => {
      // A -> B, B -> C, B -> D, C <-> D, plus self-loops.
      const at = layout(4, [[0, 1], [1, 2], [1, 3], [2, 3], [3, 2], [2, 2], [3, 3]]);
      expect(at.get(0).y).toBe(at.get(1).y);
      expect(at.get(1).y).toBeCloseTo((at.get(2).y + at.get(3).y) / 2, 6);
      expect(at.get(2).x).toBe(at.get(3).x);
    });
  });

  it("is deterministic for the same input", () => {
    const states = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const edges = [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }, { from: 4, to: 1 }, { from: 1, to: 3 }];
    const a = layeredLayout(states, edges, 1, { centerX: 0, centerY: 0 });
    const b = layeredLayout(states, edges, 1, { centerX: 0, centerY: 0 });
    expect(a).toEqual(b);
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

describe("estimateLabelSize", () => {
  it("returns a wider box for longer text", () => {
    const short = estimateLabelSize("a");
    const long = estimateLabelSize("a,b,c,d,e");
    expect(long.width).toBeGreaterThan(short.width);
  });

  it("height does not depend on text length (single-line labels only)", () => {
    const short = estimateLabelSize("a");
    const long = estimateLabelSize("a,b,c,d,e");
    expect(long.height).toBe(short.height);
  });

  it("returns a positive size even for an empty string (an edge with no symbols yet can still be mid-render)", () => {
    const { width, height } = estimateLabelSize("");
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });
});

describe("resolveLabelOverlaps", () => {
  it("leaves a label alone when nothing else is nearby (no gratuitous jitter)", () => {
    const labels = [
      { key: "a", x: 0, y: 0, width: 20, height: 14 },
      { key: "b", x: 500, y: 500, width: 20, height: 14 },
    ];
    const resolved = resolveLabelOverlaps(labels);
    expect(resolved.find((l) => l.key === "a")).toEqual({ key: "a", x: 0, y: 0 });
    expect(resolved.find((l) => l.key === "b")).toEqual({ key: "b", x: 500, y: 500 });
  });

  it("separates two labels forced onto the same point", () => {
    const labels = [
      { key: "a", x: 100, y: 100, width: 24, height: 14 },
      { key: "b", x: 100, y: 100, width: 24, height: 14 },
    ];
    const resolved = resolveLabelOverlaps(labels, { maxDrift: 40 });
    const a = resolved.find((l) => l.key === "a");
    const b = resolved.find((l) => l.key === "b");
    // Bounding boxes (24x14, centered) must no longer intersect on at least
    // one axis once resolved.
    const overlapX = 24 - Math.abs(a.x - b.x);
    const overlapY = 14 - Math.abs(a.y - b.y);
    expect(overlapX <= 0 || overlapY <= 0).toBe(true);
  });

  it("never moves a label further than maxDrift from its own original anchor", () => {
    // Three labels crammed onto the same point — more overlap than a small
    // maxDrift can ever fully resolve, so this exercises the clamp itself,
    // not just a lucky case where resolving happens to land under it anyway.
    const labels = [
      { key: "a", x: 0, y: 0, width: 20, height: 14 },
      { key: "b", x: 0, y: 0, width: 20, height: 14 },
      { key: "c", x: 0, y: 0, width: 20, height: 14 },
    ];
    const resolved = resolveLabelOverlaps(labels, { maxDrift: 5 });
    for (const l of resolved) {
      expect(Math.hypot(l.x, l.y)).toBeLessThanOrEqual(5 + 1e-6);
    }
  });

  it("does not mutate the input array (matches layeredLayout's return-a-new-array convention)", () => {
    const labels = [
      { key: "a", x: 100, y: 100, width: 24, height: 14 },
      { key: "b", x: 100, y: 100, width: 24, height: 14 },
    ];
    const snapshot = JSON.parse(JSON.stringify(labels));
    resolveLabelOverlaps(labels, { maxDrift: 40 });
    expect(labels).toEqual(snapshot);
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
