import { describe, expect, it } from "vitest";
import {
  formatFormalText,
  parseFormalText,
  planStateDiff,
  planSyncOps,
} from "./formalLogic.js";

describe("formatFormalText", () => {
  it("renders M=(Q,Σ,δ,q0,F) with one δ line per (from,symbol) pair", () => {
    const text = formatFormalText({
      states: [
        { id: 1, label: "q0", initial: true, accepting: false },
        { id: 2, label: "q1", initial: false, accepting: true },
      ],
      edges: [
        { from: 1, to: 1, epsilon: false, symbols: ["a"] },
        { from: 1, to: 2, epsilon: false, symbols: ["b"] },
      ],
      derived: { classification: "Dfa", alphabet: ["a", "b"], unreachable: [] },
    });

    expect(text).toContain("Q = {q0, q1}");
    expect(text).toContain("Σ = {a, b}");
    expect(text).toContain("q0 = q0");
    expect(text).toContain("F = {q1}");
    expect(text).toContain("δ(q0, a) = q0");
    expect(text).toContain("δ(q0, b) = q1");
  });

  it("groups multiple destinations for the same (state, symbol) with braces", () => {
    const text = formatFormalText({
      states: [
        { id: 1, label: "q0", initial: true, accepting: false },
        { id: 2, label: "q1", initial: false, accepting: false },
        { id: 3, label: "q2", initial: false, accepting: false },
      ],
      edges: [
        { from: 1, to: 2, epsilon: false, symbols: ["a"] },
        { from: 1, to: 3, epsilon: false, symbols: ["a"] },
      ],
      derived: { classification: "Nfa", alphabet: ["a"], unreachable: [] },
    });
    expect(text).toContain("δ(q0, a) = {q1, q2}");
  });

  it("renders epsilon transitions with the ε glyph", () => {
    const text = formatFormalText({
      states: [
        { id: 1, label: "q0", initial: true, accepting: false },
        { id: 2, label: "q1", initial: false, accepting: false },
      ],
      edges: [{ from: 1, to: 2, epsilon: true, symbols: [] }],
      derived: { classification: "Nfa", alphabet: [], unreachable: [] },
    });
    expect(text).toContain("δ(q0, ε) = q1");
  });
});

describe("parseFormalText", () => {
  it("parses a valid definition", () => {
    const result = parseFormalText(
      ["Q = {q0, q1}", "q0 = q0", "F = {q1}", "delta(q0, a) = q1", "delta(q1, a) = q1"].join("\n"),
    );
    expect(result.ok).toBe(true);
    expect(result.model.states).toEqual(["q0", "q1"]);
    expect(result.model.initial).toBe("q0");
    expect(result.model.accepting).toEqual(["q1"]);
    expect(result.model.transitions).toEqual(
      expect.arrayContaining([
        { from: "q0", symbol: "a", to: "q1" },
        { from: "q1", symbol: "a", to: "q1" },
      ]),
    );
  });

  it("accepts the alternate `q0, a -> q1` transition syntax", () => {
    const result = parseFormalText(["Q = {q0, q1}", "q0, a -> q1"].join("\n"));
    expect(result.ok).toBe(true);
    expect(result.model.transitions).toEqual([{ from: "q0", symbol: "a", to: "q1" }]);
  });

  it("expands a brace destination list into multiple transitions", () => {
    const result = parseFormalText(["Q = {q0, q1, q2}", "delta(q0, a) = {q1, q2}"].join("\n"));
    expect(result.ok).toBe(true);
    expect(result.model.transitions).toEqual(
      expect.arrayContaining([
        { from: "q0", symbol: "a", to: "q1" },
        { from: "q0", symbol: "a", to: "q2" },
      ]),
    );
  });

  it("treats ε/eps/lambda/empty as the epsilon symbol (null)", () => {
    for (const token of ["ε", "eps", "lambda", ""]) {
      const result = parseFormalText(["Q = {q0, q1}", `delta(q0, ${token}) = q1`].join("\n"));
      expect(result.ok).toBe(true);
      expect(result.model.transitions[0].symbol).toBeNull();
    }
  });

  it("rejects a transition referencing an undeclared state (spec: Invalid edit rejected)", () => {
    const result = parseFormalText(["Q = {q0}", "delta(q0, a) = q9"].join("\n"));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/undeclared/i);
    expect(result.error).toContain("q9");
  });

  it("rejects when Q is missing", () => {
    const result = parseFormalText("delta(q0, a) = q1");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Q/);
  });

  it("rejects an initial state not present in Q", () => {
    const result = parseFormalText(["Q = {q0}", "q0 = q9"].join("\n"));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/undeclared/i);
  });

  it("rejects an accepting state not present in Q", () => {
    const result = parseFormalText(["Q = {q0}", "F = {q9}"].join("\n"));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/undeclared/i);
  });
});

describe("planStateDiff", () => {
  it("computes labels to add and ids to remove", () => {
    const current = [
      { id: 1, label: "q0" },
      { id: 2, label: "q1" },
    ];
    const plan = planStateDiff(["q0", "q2"], current);
    expect(plan.toAddLabels).toEqual(["q2"]);
    expect(plan.toRemoveIds).toEqual([2]);
  });
});

describe("planSyncOps", () => {
  it("computes SetInitial, SetAccepting and SetEdge ops from a resolved model", () => {
    const resolvedIdOf = new Map([
      ["q0", 1],
      ["q1", 2],
    ]);
    const model = {
      states: ["q0", "q1"],
      initial: "q1",
      accepting: ["q1"],
      transitions: [{ from: "q0", symbol: "a", to: "q1" }],
    };
    const currentStates = [
      { id: 1, label: "q0", initial: true, accepting: false },
      { id: 2, label: "q1", initial: false, accepting: false },
    ];
    const currentEdges = [];

    const ops = planSyncOps(model, resolvedIdOf, currentStates, currentEdges);

    expect(ops).toEqual(
      expect.arrayContaining([
        { op: "SetInitial", id: 2 },
        { op: "SetAccepting", id: 2, accepting: true },
        { op: "SetEdge", from: 1, to: 2, epsilon: false, symbols: ["a"] },
      ]),
    );
  });

  it("clears an existing edge that is no longer present in the model", () => {
    const resolvedIdOf = new Map([
      ["q0", 1],
      ["q1", 2],
    ]);
    const model = { states: ["q0", "q1"], initial: "q0", accepting: [], transitions: [] };
    const currentStates = [
      { id: 1, label: "q0", initial: true, accepting: false },
      { id: 2, label: "q1", initial: false, accepting: false },
    ];
    const currentEdges = [{ from: 1, to: 2, epsilon: false, symbols: ["a"] }];

    const ops = planSyncOps(model, resolvedIdOf, currentStates, currentEdges);
    expect(ops).toEqual(
      expect.arrayContaining([{ op: "SetEdge", from: 1, to: 2, epsilon: false, symbols: [] }]),
    );
  });
});
