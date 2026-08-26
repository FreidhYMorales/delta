import { describe, expect, it } from "vitest";
import {
  cellValue,
  computeCellUpdateOps,
  nameWithMarkers,
  parseAlphabetInput,
  parseCellEntries,
  parseNameCell,
  rowLabel,
} from "./mealyTableLogic.js";

describe("parseCellEntries", () => {
  it("parses comma-separated target/output pairs", () => {
    expect(parseCellEntries("q1/x, q2/y")).toEqual([
      { label: "q1", output: "x" },
      { label: "q2", output: "y" },
    ]);
  });

  it("skips malformed pairs (no '/') and empty entries", () => {
    expect(parseCellEntries("q1/x, , q2, q3/")).toEqual([{ label: "q1", output: "x" }]);
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

describe("cellValue", () => {
  const labelOf = new Map([
    [1, "q0"],
    [2, "q1"],
  ]);
  const edges = [
    { from: 1, to: 1, transitions: [["a", "x"]] },
    { from: 1, to: 2, transitions: [["b", "y"]] },
  ];

  it("returns target/output for the matching input symbol", () => {
    expect(cellValue(edges, 1, "a", labelOf)).toEqual(["q0/x"]);
    expect(cellValue(edges, 1, "b", labelOf)).toEqual(["q1/y"]);
  });

  it("returns an empty array when no edge carries that input", () => {
    expect(cellValue(edges, 1, "c", labelOf)).toEqual([]);
  });

  it("returns multiple pairs under nondeterminism (two edges, same input)", () => {
    const nd = [...edges, { from: 1, to: 2, transitions: [] }];
    nd[2] = { from: 1, to: 2, transitions: [["a", "z"]] };
    expect(cellValue(nd, 1, "a", labelOf)).toEqual(["q0/x", "q1/z"]);
  });
});

describe("computeCellUpdateOps", () => {
  it("adds a new entry on a brand-new edge", () => {
    const ops = computeCellUpdateOps(1, "a", [{ to: 2, output: "x" }], []);
    expect(ops).toEqual([{ op: "SetTransitions", from: 1, to: 2, entries: [["a", "x"]] }]);
  });

  it("updates the output on an existing entry for the same input", () => {
    const edgesFromState = [{ from: 1, to: 2, transitions: [["a", "old"]] }];
    const ops = computeCellUpdateOps(1, "a", [{ to: 2, output: "new" }], edgesFromState);
    expect(ops).toEqual([{ op: "SetTransitions", from: 1, to: 2, entries: [["a", "new"]] }]);
  });

  it("leaves an edge untouched when the desired pair already matches", () => {
    const edgesFromState = [{ from: 1, to: 2, transitions: [["a", "x"]] }];
    const ops = computeCellUpdateOps(1, "a", [{ to: 2, output: "x" }], edgesFromState);
    expect(ops).toEqual([]);
  });

  it("strips the symbol's entry from an edge no longer desired, preserving other inputs", () => {
    const edgesFromState = [{ from: 1, to: 2, transitions: [["a", "x"], ["b", "y"]] }];
    const ops = computeCellUpdateOps(1, "a", [], edgesFromState);
    expect(ops).toEqual([{ op: "SetTransitions", from: 1, to: 2, entries: [["b", "y"]] }]);
  });

  it("supports two desired targets under nondeterminism (two SetTransitions ops)", () => {
    const ops = computeCellUpdateOps(1, "a", [{ to: 2, output: "x" }, { to: 3, output: "y" }], []);
    expect(ops).toEqual(
      expect.arrayContaining([
        { op: "SetTransitions", from: 1, to: 2, entries: [["a", "x"]] },
        { op: "SetTransitions", from: 1, to: 3, entries: [["a", "y"]] },
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
