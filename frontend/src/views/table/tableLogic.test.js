import { describe, expect, it } from "vitest";
import { EPSILON, cellValue, computeCellUpdateOps, parseCellTargets, rowLabel } from "./tableLogic.js";

describe("parseCellTargets", () => {
  it("splits comma-separated labels, trims whitespace, drops empties and dedupes", () => {
    expect(parseCellTargets(" q1, q2 ,, q1,q3")).toEqual(["q1", "q2", "q3"]);
  });

  it("returns an empty array for an empty cell", () => {
    expect(parseCellTargets("")).toEqual([]);
  });
});

describe("rowLabel", () => {
  it("prefixes initial states with →", () => {
    expect(rowLabel({ label: "q0", initial: true, accepting: false })).toBe("→ q0");
  });

  it("prefixes accepting states with *", () => {
    expect(rowLabel({ label: "q1", initial: false, accepting: true })).toBe("* q1");
  });

  it("combines both markers", () => {
    expect(rowLabel({ label: "q0", initial: true, accepting: true })).toBe("→* q0");
  });

  it("has no prefix for a plain state", () => {
    expect(rowLabel({ label: "q2", initial: false, accepting: false })).toBe("q2");
  });
});

describe("cellValue", () => {
  const labelOf = new Map([
    [1, "q0"],
    [2, "q1"],
  ]);
  const edges = [
    { from: 1, to: 1, epsilon: false, symbols: ["a"] },
    { from: 1, to: 2, epsilon: false, symbols: ["a", "b"] },
    { from: 1, to: 2, epsilon: true, symbols: [] },
  ];

  it("lists every destination whose symbols include the given column", () => {
    expect(cellValue(edges, 1, "a", labelOf)).toEqual(["q0", "q1"]);
    expect(cellValue(edges, 1, "b", labelOf)).toEqual(["q1"]);
  });

  it("reads the epsilon column from the epsilon flag, not symbols", () => {
    expect(cellValue(edges, 1, EPSILON, labelOf)).toEqual(["q1"]);
  });

  it("is empty for a state with no outgoing edge on that symbol", () => {
    expect(cellValue(edges, 2, "a", labelOf)).toEqual([]);
  });
});

describe("computeCellUpdateOps", () => {
  it("adds the symbol to a brand new target with no prior edge", () => {
    const ops = computeCellUpdateOps(1, "a", [2], []);
    expect(ops).toEqual([{ op: "SetEdge", from: 1, to: 2, epsilon: false, symbols: ["a"] }]);
  });

  it("redirects a transition target: removes the symbol from the old target, adds it to the new one", () => {
    const edgesFromState = [{ from: 1, to: 2, epsilon: false, symbols: ["a"] }];
    const ops = computeCellUpdateOps(1, "a", [3], edgesFromState);

    expect(ops).toEqual(
      expect.arrayContaining([
        { op: "SetEdge", from: 1, to: 2, epsilon: false, symbols: [] },
        { op: "SetEdge", from: 1, to: 3, epsilon: false, symbols: ["a"] },
      ]),
    );
    expect(ops).toHaveLength(2);
  });

  it("is a no-op when the target set is unchanged", () => {
    const edgesFromState = [{ from: 1, to: 2, epsilon: false, symbols: ["a"] }];
    expect(computeCellUpdateOps(1, "a", [2], edgesFromState)).toEqual([]);
  });

  it("preserves other symbols already on the edge being narrowed", () => {
    const edgesFromState = [{ from: 1, to: 2, epsilon: false, symbols: ["a", "b"] }];
    const ops = computeCellUpdateOps(1, "a", [], edgesFromState);
    expect(ops).toEqual([{ op: "SetEdge", from: 1, to: 2, epsilon: false, symbols: ["b"] }]);
  });

  it("supports multiple destinations (NFA branching) in one cell", () => {
    const ops = computeCellUpdateOps(1, "a", [2, 3], []);
    expect(ops).toEqual(
      expect.arrayContaining([
        { op: "SetEdge", from: 1, to: 2, epsilon: false, symbols: ["a"] },
        { op: "SetEdge", from: 1, to: 3, epsilon: false, symbols: ["a"] },
      ]),
    );
  });

  it("handles the epsilon column via the epsilon flag, not the symbols array", () => {
    const ops = computeCellUpdateOps(1, EPSILON, [2], []);
    expect(ops).toEqual([{ op: "SetEdge", from: 1, to: 2, epsilon: true, symbols: [] }]);
  });
});
