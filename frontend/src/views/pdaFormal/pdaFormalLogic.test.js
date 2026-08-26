import { describe, expect, it } from "vitest";
import { formatFormalText, parseFormalText, planStateDiff, planSyncOps } from "./pdaFormalLogic.js";

describe("formatFormalText", () => {
  it("renders Q/Sigma/Gamma/q0/F, one delta(from,input,pop)=(to,push) line per transition", () => {
    const text = formatFormalText({
      states: [
        { id: 1, label: "q0", initial: true, accepting: false },
        { id: 2, label: "q1", initial: false, accepting: true },
      ],
      transitions: [{ id: 1, from: 1, to: 2, input: "a", pop: ["Z"], push: ["A", "Z"] }],
      derived: { input_alphabet: ["a"], stack_alphabet: ["A", "Z"] },
    });

    expect(text).toContain("Q = {q0, q1}");
    expect(text).toContain("Σ = {a}");
    expect(text).toContain("Γ = {A, Z}");
    expect(text).toContain("q0 = q0");
    expect(text).toContain("F = {q1}");
    expect(text).toContain("δ(q0, a, Z) = (q1, A Z)");
    expect(text).toMatch(/#.*Z0.*"Z"/);
  });

  it("renders epsilon for empty input/pop/push fields", () => {
    const text = formatFormalText({
      states: [
        { id: 1, label: "q0", initial: true, accepting: false },
        { id: 2, label: "q1", initial: false, accepting: false },
      ],
      transitions: [{ id: 1, from: 1, to: 2, input: null, pop: [], push: [] }],
      derived: { input_alphabet: [], stack_alphabet: [] },
    });
    expect(text).toContain("δ(q0, ε, ε) = (q1, ε)");
  });

  it("renders an empty F when no state is accepting", () => {
    const text = formatFormalText({
      states: [{ id: 1, label: "q0", initial: true, accepting: false }],
      transitions: [],
      derived: { input_alphabet: [], stack_alphabet: [] },
    });
    expect(text).toContain("F = {}");
  });

  it("gives every transition between the same (from,to) pair its own line", () => {
    const text = formatFormalText({
      states: [
        { id: 1, label: "q0", initial: true, accepting: false },
        { id: 2, label: "q1", initial: false, accepting: false },
      ],
      transitions: [
        { id: 1, from: 1, to: 2, input: "a", pop: [], push: [] },
        { id: 2, from: 1, to: 2, input: "b", pop: ["Z"], push: [] },
      ],
      derived: { input_alphabet: ["a", "b"], stack_alphabet: ["Z"] },
    });
    expect(text).toContain("δ(q0, a, ε) = (q1, ε)");
    expect(text).toContain("δ(q0, b, Z) = (q1, ε)");
  });
});

describe("parseFormalText", () => {
  it("parses a well-formed definition, including F and multi-symbol pop/push", () => {
    const text = [
      "Q = {q0, q1}",
      "q0 = q0",
      "F = {q1}",
      "delta(q0, a, Z) = (q1, A Z)",
      "delta(q0, ε, ε) = (q1, ε)",
    ].join("\n");
    const result = parseFormalText(text);
    expect(result.ok).toBe(true);
    expect(result.model).toEqual({
      states: ["q0", "q1"],
      initial: "q0",
      accepting: ["q1"],
      transitions: [
        { from: "q0", input: "a", pop: ["Z"], to: "q1", push: ["A", "Z"] },
        { from: "q0", input: null, pop: [], to: "q1", push: [] },
      ],
    });
  });

  it("ignores comment lines and informational Sigma/Gamma lines", () => {
    const result = parseFormalText("Q = {q0}\nSigma = {a}\nGamma = {Z}\n# just a note");
    expect(result.ok).toBe(true);
  });

  it("requires a Q declaration", () => {
    expect(parseFormalText("q0 = q0").ok).toBe(false);
  });

  it("defaults F to empty when omitted", () => {
    const result = parseFormalText("Q = {q0}");
    expect(result.ok).toBe(true);
    expect(result.model.accepting).toEqual([]);
  });

  it("rejects an undeclared state in F", () => {
    const result = parseFormalText("Q = {q0}\nF = {q9}");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/undeclared/i);
  });

  it("rejects an undeclared state in a delta transition", () => {
    const result = parseFormalText("Q = {q0}\ndelta(q0, a, Z) = (q9, Z)");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/undeclared/i);
  });

  it("rejects an unrecognized line", () => {
    expect(parseFormalText("Q = {q0}\ngarbage").ok).toBe(false);
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
    { id: 1, label: "q0", initial: true, accepting: false },
    { id: 2, label: "q1", initial: false, accepting: false },
  ];
  const resolvedIdOf = new Map([["q0", 1], ["q1", 2]]);

  it("emits SetInitial only when it changed", () => {
    const model = { states: ["q0", "q1"], initial: "q1", accepting: [], transitions: [] };
    const ops = planSyncOps(model, resolvedIdOf, currentStates, []);
    expect(ops).toEqual(expect.arrayContaining([{ op: "SetInitial", id: 2 }]));
  });

  it("emits SetAccepting when F changed", () => {
    const model = { states: ["q0", "q1"], initial: "q0", accepting: ["q1"], transitions: [] };
    const ops = planSyncOps(model, resolvedIdOf, currentStates, []);
    expect(ops).toEqual(expect.arrayContaining([{ op: "SetAccepting", id: 2, accepting: true }]));
  });

  it("emits AddTransition for a new transition", () => {
    const model = {
      states: ["q0", "q1"],
      initial: "q0",
      accepting: [],
      transitions: [{ from: "q0", input: "a", pop: [], to: "q1", push: [] }],
    };
    const ops = planSyncOps(model, resolvedIdOf, currentStates, []);
    expect(ops).toEqual(
      expect.arrayContaining([{ op: "AddTransition", from: 1, to: 2, input: "a", pop: [], push: [] }]),
    );
  });

  it("emits RemoveTransition for a dropped transition", () => {
    const model = { states: ["q0", "q1"], initial: "q0", accepting: [], transitions: [] };
    const currentTransitions = [{ id: 7, from: 1, to: 2, input: "a", pop: [], push: [] }];
    const ops = planSyncOps(model, resolvedIdOf, currentStates, currentTransitions);
    expect(ops).toEqual(expect.arrayContaining([{ op: "RemoveTransition", id: 7 }]));
  });

  it("emits nothing when the document already matches the model", () => {
    const model = {
      states: ["q0", "q1"],
      initial: "q0",
      accepting: [],
      transitions: [{ from: "q0", input: "a", pop: [], to: "q1", push: [] }],
    };
    const currentTransitions = [{ id: 7, from: 1, to: 2, input: "a", pop: [], push: [] }];
    expect(planSyncOps(model, resolvedIdOf, currentStates, currentTransitions)).toEqual([]);
  });

  it("round-trips two transitions between the same (from,to) pair without collapsing or losing either", () => {
    const model = {
      states: ["q0", "q1"],
      initial: "q0",
      accepting: [],
      transitions: [
        { from: "q0", input: "a", pop: [], to: "q1", push: [] },
        { from: "q0", input: "b", pop: ["Z"], to: "q1", push: [] },
      ],
    };
    const ops = planSyncOps(model, resolvedIdOf, currentStates, []);
    expect(ops).toEqual(
      expect.arrayContaining([
        { op: "AddTransition", from: 1, to: 2, input: "a", pop: [], push: [] },
        { op: "AddTransition", from: 1, to: 2, input: "b", pop: ["Z"], push: [] },
      ]),
    );
    expect(ops.filter((o) => o.op === "AddTransition")).toHaveLength(2);
  });

  it("edits one of two same-pair transitions without disturbing the other (remove+add by tuple identity)", () => {
    const currentTransitions = [
      { id: 7, from: 1, to: 2, input: "a", pop: [], push: [] },
      { id: 8, from: 1, to: 2, input: "b", pop: ["Z"], push: [] },
    ];
    const model = {
      states: ["q0", "q1"],
      initial: "q0",
      accepting: [],
      transitions: [
        { from: "q0", input: "c", pop: [], to: "q1", push: [] }, // "a" -> "c"
        { from: "q0", input: "b", pop: ["Z"], to: "q1", push: [] }, // unchanged
      ],
    };
    const ops = planSyncOps(model, resolvedIdOf, currentStates, currentTransitions);
    expect(ops).toEqual([
      { op: "RemoveTransition", id: 7 },
      { op: "AddTransition", from: 1, to: 2, input: "c", pop: [], push: [] },
    ]);
  });
});
