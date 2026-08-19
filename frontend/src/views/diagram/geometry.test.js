import { describe, expect, it } from "vitest";
import {
  circleLayout,
  curvedEdgePath,
  edgeEndpoints,
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
