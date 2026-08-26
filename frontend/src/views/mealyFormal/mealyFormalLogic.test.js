import { describe, expect, it } from "vitest";
import { formatFormalText, parseFormalText, planStateDiff, planSyncOps } from "./mealyFormalLogic.js";

function doc() {
  return {
    states: [
      { id: 1, label: "q0", initial: true },
      { id: 2, label: "q1", initial: false },
    ],
    edges: [{ from: 1, to: 2, transitions: [["a", "x"]] }],
    derived: { input_alphabet: ["a"], output_alphabet: ["x"] },
  };
}

describe("formatFormalText", () => {
  it("renders the Mealy 6-tuple with no F", () => {
    const text = formatFormalText(doc());
    expect(text).toContain("Q = {q0, q1}");
    expect(text).toContain("Σ = {a}");
    expect(text).toContain("Δ = {x}");
    expect(text).toContain("q0 = q0");
    expect(text).toContain("δ(q0, a) = q1/x");
    expect(text).not.toContain("F =");
  });
});

describe("parseFormalText", () => {
  it("parses a valid definition", () => {
    const text = ["Q = {q0, q1}", "q0 = q0", "delta(q0, a) = q1/x"].join("\n");
    const result = parseFormalText(text);
    expect(result.ok).toBe(true);
    expect(result.model).toEqual({
      states: ["q0", "q1"],
      initial: "q0",
      transitions: [{ from: "q0", input: "a", to: "q1", output: "x" }],
    });
  });

  it("rejects a transition missing an output (no '/')", () => {
    const text = ["Q = {q0}", "delta(q0, a) = q0"].join("\n");
    const result = parseFormalText(text);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/output/i);
  });

  it("rejects an undeclared state in q0", () => {
    const text = ["Q = {q0}", "q0 = q9"].join("\n");
    const result = parseFormalText(text);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/undeclared/i);
  });

  it("rejects an undeclared target state in a transition", () => {
    const text = ["Q = {q0}", "delta(q0, a) = q9/x"].join("\n");
    const result = parseFormalText(text);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/undeclared/i);
  });

  it("requires a Q declaration", () => {
    const result = parseFormalText("q0 = q0");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Q declaration/i);
  });
});

describe("planStateDiff", () => {
  it("computes add/remove labels against the current states", () => {
    const diff = planStateDiff(["q0", "q2"], [{ id: 1, label: "q0" }, { id: 2, label: "q1" }]);
    expect(diff.toAddLabels).toEqual(["q2"]);
    expect(diff.toRemoveIds).toEqual([2]);
  });
});

describe("planSyncOps", () => {
  it("emits SetInitial when the initial state changed", () => {
    const model = { states: ["q0", "q1"], initial: "q1", transitions: [] };
    const resolvedIdOf = new Map([["q0", 1], ["q1", 2]]);
    const currentStates = [{ id: 1, label: "q0", initial: true }, { id: 2, label: "q1", initial: false }];
    const ops = planSyncOps(model, resolvedIdOf, currentStates, []);
    expect(ops).toContainEqual({ op: "SetInitial", id: 2 });
  });

  it("emits SetTransitions for a changed edge, grouping all entries for that (from,to)", () => {
    const model = {
      states: ["q0", "q1"],
      initial: "q0",
      transitions: [
        { from: "q0", input: "a", to: "q1", output: "x" },
        { from: "q0", input: "b", to: "q1", output: "y" },
      ],
    };
    const resolvedIdOf = new Map([["q0", 1], ["q1", 2]]);
    const currentStates = [{ id: 1, label: "q0", initial: true }, { id: 2, label: "q1", initial: false }];
    const ops = planSyncOps(model, resolvedIdOf, currentStates, []);
    expect(ops).toContainEqual({
      op: "SetTransitions",
      from: 1,
      to: 2,
      entries: expect.arrayContaining([["a", "x"], ["b", "y"]]),
    });
  });

  it("emits nothing when the document already matches the model", () => {
    const model = {
      states: ["q0", "q1"],
      initial: "q0",
      transitions: [{ from: "q0", input: "a", to: "q1", output: "x" }],
    };
    const resolvedIdOf = new Map([["q0", 1], ["q1", 2]]);
    const currentStates = [{ id: 1, label: "q0", initial: true }, { id: 2, label: "q1", initial: false }];
    const currentEdges = [{ from: 1, to: 2, transitions: [["a", "x"]] }];
    const ops = planSyncOps(model, resolvedIdOf, currentStates, currentEdges);
    expect(ops).toEqual([]);
  });
});
