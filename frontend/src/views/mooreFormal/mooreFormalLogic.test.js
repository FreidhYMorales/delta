import { describe, expect, it } from "vitest";
import { formatFormalText, parseFormalText, planStateDiff, planSyncOps } from "./mooreFormalLogic.js";

describe("formatFormalText", () => {
  it("renders Q/Sigma/Delta/q0, separate delta and lambda lines, no F", () => {
    const text = formatFormalText({
      states: [
        { id: 1, label: "q0", initial: true, output: "even" },
        { id: 2, label: "q1", initial: false, output: "odd" },
      ],
      edges: [{ from: 1, to: 2, inputs: ["a"] }],
      derived: { input_alphabet: ["a"], output_alphabet: ["even", "odd"] },
    });

    expect(text).toContain("Q = {q0, q1}");
    expect(text).toContain("Sigma = {a}");
    expect(text).toContain("Delta = {even, odd}");
    expect(text).toContain("q0 = q0");
    expect(text).toContain("delta(q0, a) = q1");
    expect(text).toContain("lambda(q0) = even");
    expect(text).toContain("lambda(q1) = odd");
    expect(text).not.toContain("F =");
  });

  it("omits a lambda line for a state with no output set", () => {
    const text = formatFormalText({
      states: [{ id: 1, label: "q0", initial: true, output: null }],
      edges: [],
      derived: { input_alphabet: [], output_alphabet: [] },
    });
    expect(text).not.toContain("lambda(q0)");
  });
});

describe("parseFormalText", () => {
  it("parses a well-formed definition", () => {
    const text = ["Q = {q0, q1}", "q0 = q0", "delta(q0, a) = q1", "lambda(q0) = even", "lambda(q1) = odd"].join("\n");
    const result = parseFormalText(text);
    expect(result.ok).toBe(true);
    expect(result.model).toEqual({
      states: ["q0", "q1"],
      initial: "q0",
      transitions: [{ from: "q0", input: "a", to: "q1" }],
      outputs: [
        { state: "q0", output: "even" },
        { state: "q1", output: "odd" },
      ],
    });
  });

  it("requires a Q declaration", () => {
    expect(parseFormalText("q0 = q0").ok).toBe(false);
  });

  it("rejects an undeclared state in a delta transition", () => {
    const result = parseFormalText("Q = {q0}\ndelta(q0, a) = q9");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/undeclared/i);
  });

  it("rejects an undeclared state in a lambda line", () => {
    const result = parseFormalText("Q = {q0}\nlambda(q9) = even");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/undeclared/i);
  });

  it("rejects a lambda line with no output", () => {
    const result = parseFormalText("Q = {q0}\nlambda(q0) = ");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/missing output/i);
  });

  it("rejects an unrecognized line", () => {
    expect(parseFormalText("Q = {q0}\ngarbage").ok).toBe(false);
  });

  it("ignores informational Sigma/Delta lines", () => {
    const result = parseFormalText("Q = {q0}\nSigma = {a}\nDelta = {even}");
    expect(result.ok).toBe(true);
  });
});

describe("planStateDiff", () => {
  it("computes states to add and remove by label", () => {
    const current = [{ id: 1, label: "q0" }, { id: 2, label: "q1" }];
    expect(planStateDiff(["q0", "q2"], current)).toEqual({ toAddLabels: ["q2"], toRemoveIds: [2] });
  });
});

describe("planSyncOps", () => {
  const currentStates = [
    { id: 1, label: "q0", initial: true, output: "even" },
    { id: 2, label: "q1", initial: false, output: "odd" },
  ];
  const resolvedIdOf = new Map([["q0", 1], ["q1", 2]]);

  it("emits SetInitial only when it changed", () => {
    const model = { states: ["q0", "q1"], initial: "q1", transitions: [], outputs: [{ state: "q0", output: "even" }, { state: "q1", output: "odd" }] };
    const ops = planSyncOps(model, resolvedIdOf, currentStates, []);
    expect(ops).toEqual(expect.arrayContaining([{ op: "SetInitial", id: 2 }]));
  });

  it("emits SetTransitions for a new edge", () => {
    const model = {
      states: ["q0", "q1"],
      initial: "q0",
      transitions: [{ from: "q0", input: "a", to: "q1" }],
      outputs: [{ state: "q0", output: "even" }, { state: "q1", output: "odd" }],
    };
    const ops = planSyncOps(model, resolvedIdOf, currentStates, []);
    expect(ops).toEqual(expect.arrayContaining([{ op: "SetTransitions", from: 1, to: 2, inputs: ["a"] }]));
  });

  it("emits SetOutput when a state's output changed", () => {
    const model = { states: ["q0", "q1"], initial: "q0", transitions: [], outputs: [{ state: "q0", output: "zero" }, { state: "q1", output: "odd" }] };
    const ops = planSyncOps(model, resolvedIdOf, currentStates, []);
    expect(ops).toEqual(expect.arrayContaining([{ op: "SetOutput", state: 1, output: "zero" }]));
  });

  it("emits SetOutput: null for a state whose lambda line was removed", () => {
    const model = { states: ["q0", "q1"], initial: "q0", transitions: [], outputs: [{ state: "q1", output: "odd" }] };
    const ops = planSyncOps(model, resolvedIdOf, currentStates, []);
    expect(ops).toEqual(expect.arrayContaining([{ op: "SetOutput", state: 1, output: null }]));
  });

  it("emits nothing when the document already matches the model", () => {
    const model = { states: ["q0", "q1"], initial: "q0", transitions: [], outputs: [{ state: "q0", output: "even" }, { state: "q1", output: "odd" }] };
    expect(planSyncOps(model, resolvedIdOf, currentStates, [])).toEqual([]);
  });
});
