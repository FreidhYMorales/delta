import { describe, expect, it } from "vitest";
import { computeAddTransitionOp, computeRetargetOps, computeTapeFieldEditOp, sameTapes } from "./tmTableLogic.js";

describe("computeTapeFieldEditOp", () => {
  const transition = {
    id: 7,
    from: 1,
    to: 2,
    tapes: [
      { read: "a", write: "b", direction: "R" },
      { read: "c", write: "d", direction: "L" },
    ],
  };

  it("edits only the targeted tape index, leaving the other untouched", () => {
    expect(computeTapeFieldEditOp(transition, 0, "x ; y , L")).toEqual({
      op: "EditTransition",
      id: 7,
      tapes: [
        { read: "x", write: "y", direction: "L" },
        { read: "c", write: "d", direction: "L" },
      ],
    });
  });

  it("edits the second tape index, leaving the first untouched", () => {
    expect(computeTapeFieldEditOp(transition, 1, "e ; f , S")).toEqual({
      op: "EditTransition",
      id: 7,
      tapes: [
        { read: "a", write: "b", direction: "R" },
        { read: "e", write: "f", direction: "S" },
      ],
    });
  });

  it("returns null when the parsed value is unchanged", () => {
    expect(computeTapeFieldEditOp(transition, 0, "a ; b , R")).toBeNull();
  });
});

describe("computeRetargetOps", () => {
  const transition = {
    id: 7,
    from: 1,
    to: 2,
    tapes: [{ read: "a", write: "b", direction: "R" }],
  };

  it("returns RemoveTransition + AddTransition when the target changes, preserving tapes", () => {
    expect(computeRetargetOps(transition, "to", 3)).toEqual([
      { op: "RemoveTransition", id: 7 },
      { op: "AddTransition", from: 1, to: 3, tapes: transition.tapes },
    ]);
  });

  it("returns RemoveTransition + AddTransition when the source changes", () => {
    expect(computeRetargetOps(transition, "from", 3)).toEqual([
      { op: "RemoveTransition", id: 7 },
      { op: "AddTransition", from: 3, to: 2, tapes: transition.tapes },
    ]);
  });

  it("returns null when the endpoint is unchanged", () => {
    expect(computeRetargetOps(transition, "to", 2)).toBeNull();
  });
});

describe("computeAddTransitionOp", () => {
  it("builds an AddTransition op, parsing every tapeText for a multi-tape case", () => {
    expect(computeAddTransitionOp({ from: 1, to: 2, tapeTexts: ["a ; b , R", "c ; d , L"] })).toEqual({
      op: "AddTransition",
      from: 1,
      to: 2,
      tapes: [
        { read: "a", write: "b", direction: "R" },
        { read: "c", write: "d", direction: "L" },
      ],
    });
  });

  it("returns null when an endpoint is missing", () => {
    expect(computeAddTransitionOp({ from: null, to: 2, tapeTexts: ["a ; b , R"] })).toBeNull();
    expect(computeAddTransitionOp({ from: 1, to: null, tapeTexts: ["a ; b , R"] })).toBeNull();
  });
});

describe("sameTapes", () => {
  it("compares arrays of tape ops by read/write/direction at every index", () => {
    const a = [{ read: "a", write: "b", direction: "R" }];
    const b = [{ read: "a", write: "b", direction: "R" }];
    const c = [{ read: "a", write: "b", direction: "L" }];
    expect(sameTapes(a, b)).toBe(true);
    expect(sameTapes(a, c)).toBe(false);
    expect(sameTapes(a, [])).toBe(false);
  });
});
