import { describe, expect, it } from "vitest";
import {
  cellValue,
  computeCellUpdateOps,
  nameWithMarkers,
  parseAlphabetInput,
  parseCellEntries,
  parseNameCell,
  parseOutputCell,
  rowLabel,
} from "./mooreTableLogic.js";

describe("parseCellEntries", () => {
  it("parses comma-separated target-state labels", () => {
    expect(parseCellEntries("q1, q2")).toEqual(["q1", "q2"]);
  });

  it("skips empty entries", () => {
    expect(parseCellEntries("q1, , q2")).toEqual(["q1", "q2"]);
  });

  it("returns an empty array for a blank cell", () => {
    expect(parseCellEntries("")).toEqual([]);
  });
});

describe("nameWithMarkers / parseNameCell", () => {
  it("shows -> for an initial state, nothing for a non-initial one", () => {
    expect(nameWithMarkers({ label: "q0", initial: true })).toBe("->q0");
    expect(nameWithMarkers({ label: "q1", initial: false })).toBe("q1");
  });

  it("round-trips through parseNameCell", () => {
    expect(parseNameCell("->q0")).toEqual({ label: "q0", initial: true });
    expect(parseNameCell("q1")).toEqual({ label: "q1", initial: false });
    expect(parseNameCell("  ->  q0 ")).toEqual({ label: "q0", initial: true });
  });
});

describe("rowLabel", () => {
  it("prefixes the unicode arrow only for the initial state", () => {
    expect(rowLabel({ label: "q0", initial: true })).toBe("→ q0");
    expect(rowLabel({ label: "q1", initial: false })).toBe("q1");
  });
});

describe("parseOutputCell", () => {
  it("returns the trimmed value when non-blank", () => {
    expect(parseOutputCell("  even  ")).toBe("even");
  });

  it("returns null for a blank cell (no output set)", () => {
    expect(parseOutputCell("")).toBeNull();
    expect(parseOutputCell("   ")).toBeNull();
  });
});

describe("cellValue", () => {
  const labelOf = new Map([
    [1, "q0"],
    [2, "q1"],
  ]);
  const edges = [
    { from: 1, to: 1, inputs: ["a"] },
    { from: 1, to: 2, inputs: ["b"] },
  ];

  it("returns the target label for the matching input symbol", () => {
    expect(cellValue(edges, 1, "a", labelOf)).toEqual(["q0"]);
    expect(cellValue(edges, 1, "b", labelOf)).toEqual(["q1"]);
  });

  it("returns an empty array when no edge carries that input", () => {
    expect(cellValue(edges, 1, "c", labelOf)).toEqual([]);
  });

  it("returns multiple targets under nondeterminism (two edges, same input)", () => {
    const nd = [...edges, { from: 1, to: 2, inputs: ["a"] }];
    expect(cellValue(nd, 1, "a", labelOf)).toEqual(["q0", "q1"]);
  });
});

describe("computeCellUpdateOps", () => {
  it("adds the symbol on a brand-new edge", () => {
    const ops = computeCellUpdateOps(1, "a", [2], []);
    expect(ops).toEqual([{ op: "SetTransitions", from: 1, to: 2, inputs: ["a"] }]);
  });

  it("leaves an edge untouched when the desired target already carries the symbol", () => {
    const edgesFromState = [{ from: 1, to: 2, inputs: ["a"] }];
    const ops = computeCellUpdateOps(1, "a", [2], edgesFromState);
    expect(ops).toEqual([]);
  });

  it("adds the symbol to an existing edge that targets the right state but lacks it", () => {
    const edgesFromState = [{ from: 1, to: 2, inputs: ["b"] }];
    const ops = computeCellUpdateOps(1, "a", [2], edgesFromState);
    expect(ops).toEqual([{ op: "SetTransitions", from: 1, to: 2, inputs: ["b", "a"] }]);
  });

  it("strips the symbol from an edge no longer desired, preserving other inputs", () => {
    const edgesFromState = [{ from: 1, to: 2, inputs: ["a", "b"] }];
    const ops = computeCellUpdateOps(1, "a", [], edgesFromState);
    expect(ops).toEqual([{ op: "SetTransitions", from: 1, to: 2, inputs: ["b"] }]);
  });

  it("supports two desired targets under nondeterminism (two SetTransitions ops)", () => {
    const ops = computeCellUpdateOps(1, "a", [2, 3], []);
    expect(ops).toEqual(
      expect.arrayContaining([
        { op: "SetTransitions", from: 1, to: 2, inputs: ["a"] },
        { op: "SetTransitions", from: 1, to: 3, inputs: ["a"] },
      ]),
    );
  });
});

describe("parseAlphabetInput", () => {
  it("splits, trims, and dedupes, skipping empty entries", () => {
    expect(parseAlphabetInput("a, b, a, , c")).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array for a blank string", () => {
    expect(parseAlphabetInput("")).toEqual([]);
  });

  it("converts typed Greek letter names to their symbols", () => {
    expect(parseAlphabetInput("delta, sigma, a")).toEqual(["δ", "σ", "a"]);
  });
});
