import { describe, expect, it } from "vitest";
import { computeAddTransitionOp, computeFieldEditOp, computeRetargetOps } from "./pdaTableLogic.js";

describe("computeFieldEditOp", () => {
  const transition = { id: 7, from: 1, to: 2, input: "a", pop: ["Z"], push: ["A", "Z"] };

  it("edits the input field, keeping pop/push", () => {
    expect(computeFieldEditOp(transition, "input", "b")).toEqual({
      op: "EditTransition",
      id: 7,
      input: "b",
      pop: ["Z"],
      push: ["A", "Z"],
    });
  });

  it("edits the pop field, keeping input/push", () => {
    expect(computeFieldEditOp(transition, "pop", "A B")).toEqual({
      op: "EditTransition",
      id: 7,
      input: "a",
      pop: ["A", "B"],
      push: ["A", "Z"],
    });
  });

  it("a blank input field means epsilon (null)", () => {
    expect(computeFieldEditOp(transition, "input", "")).toEqual({
      op: "EditTransition",
      id: 7,
      input: null,
      pop: ["Z"],
      push: ["A", "Z"],
    });
  });

  it("returns null when the parsed value is unchanged", () => {
    expect(computeFieldEditOp(transition, "input", "a")).toBeNull();
    expect(computeFieldEditOp(transition, "pop", "Z")).toBeNull();
  });
});

describe("computeRetargetOps", () => {
  const transition = { id: 7, from: 1, to: 2, input: "a", pop: ["Z"], push: [] };

  it("returns RemoveTransition + AddTransition when the target changes", () => {
    expect(computeRetargetOps(transition, "to", 3)).toEqual([
      { op: "RemoveTransition", id: 7 },
      { op: "AddTransition", from: 1, to: 3, input: "a", pop: ["Z"], push: [] },
    ]);
  });

  it("returns RemoveTransition + AddTransition when the source changes", () => {
    expect(computeRetargetOps(transition, "from", 3)).toEqual([
      { op: "RemoveTransition", id: 7 },
      { op: "AddTransition", from: 3, to: 2, input: "a", pop: ["Z"], push: [] },
    ]);
  });

  it("returns null when the endpoint is unchanged", () => {
    expect(computeRetargetOps(transition, "to", 2)).toBeNull();
  });
});

describe("computeAddTransitionOp", () => {
  it("builds an AddTransition op, parsing input/pop/push", () => {
    expect(computeAddTransitionOp({ from: 1, to: 2, input: "a", pop: "A Z", push: "" })).toEqual({
      op: "AddTransition",
      from: 1,
      to: 2,
      input: "a",
      pop: ["A", "Z"],
      push: [],
    });
  });

  it("returns null when an endpoint is missing", () => {
    expect(computeAddTransitionOp({ from: null, to: 2, input: "a", pop: "", push: "" })).toBeNull();
    expect(computeAddTransitionOp({ from: 1, to: null, input: "a", pop: "", push: "" })).toBeNull();
  });
});
