import { describe, expect, it } from "vitest";
import { circleLayout, edgeEndpoints, nextStateLabel, statusSummary } from "./geometry.js";

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
