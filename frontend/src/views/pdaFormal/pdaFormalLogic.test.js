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
    expect(text).toContain("\nZ0 = Z\n");
    expect(text).not.toContain("#");
  });

  it("renders the machine's own initial stack symbol as a real Z0 line", () => {
    const text = formatFormalText({
      states: [],
      transitions: [],
      derived: { input_alphabet: [], stack_alphabet: ["Z0"], initial_stack_symbol: "Z0" },
    });
    expect(text).toContain("Z0 = Z0");
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

// Written as in the course workbook "Hoja de trabajo 10", with its sets split
// into one line each and `f(...)` written as `δ(...)` (both are story 04). The
// expected rows repeat `crates/automata-core/tests/pda_course_workbook.rs`,
// whose machines the engine already accepts the workbook's words on.
describe("parseFormalText course exercises", () => {
  function rows(text) {
    const result = parseFormalText(text);
    expect(result.ok).toBe(true);
    return result.model.transitions.map((t) => [t.from, t.input ?? "", t.pop.join(" "), t.to, t.push.join(" ")]);
  }

  it("reads exercise 1-1", () => {
    const text = `Q = {mn, m, t, n}
q0 = mn
Z0 = Z
F = {n}
δ(mn, a, Z) = (mn, NZ)
δ(mn, a, M) = (mn, MM)
δ(mn, a, N) = (mn, MN)
δ(mn, a, N) = (mn, NN)
δ(mn, b, N) = (m, BN)
δ(mn, b, M) = (m, ε)
δ(m, b, B) = (m, BB)
δ(m, b, N) = (m, BN)
δ(m, b, M) = (m, ε)
δ(m, a, B) = (t, ε)
δ(t, a, B) = (t, ε)
δ(t, b, N) = (n, ε)
δ(n, b, N) = (n, ε)
δ(n, ε, Z) = (n, ε)`;

    expect(rows(text)).toEqual([
      ["mn", "a", "Z", "mn", "N Z"],
      ["mn", "a", "M", "mn", "M M"],
      ["mn", "a", "N", "mn", "M N"],
      ["mn", "a", "N", "mn", "N N"],
      ["mn", "b", "N", "m", "B N"],
      ["mn", "b", "M", "m", ""],
      ["m", "b", "B", "m", "B B"],
      ["m", "b", "N", "m", "B N"],
      ["m", "b", "M", "m", ""],
      ["m", "a", "B", "t", ""],
      ["t", "a", "B", "t", ""],
      ["t", "b", "N", "n", ""],
      ["n", "b", "N", "n", ""],
      ["n", "", "Z", "n", ""],
    ]);
  });

  it("reads exercise 2-1, which writes λ", () => {
    const text = `Q = {q1, q2, q3, q4}
q0 = q1
Z0 = A
F = {q4}
δ(q1, a, A) = (q2, BA)
δ(q1, a, A) = (q4, A)
δ(q1, ε, A) = (q4, ε)
δ(q2, a, B) = (q2, BB)
δ(q2, b, B) = (q3, ε)
δ(q3, λ, A) = (q4, A)
δ(q3, b, B) = (q3, ε)`;

    expect(rows(text)).toEqual([
      ["q1", "a", "A", "q2", "B A"],
      ["q1", "a", "A", "q4", "A"],
      ["q1", "", "A", "q4", ""],
      ["q2", "a", "B", "q2", "B B"],
      ["q2", "b", "B", "q3", ""],
      ["q3", "", "A", "q4", "A"],
      ["q3", "b", "B", "q3", ""],
    ]);
  });

  it("reads exercise 2-2, whose initial stack symbol is Z0", () => {
    const text = `Q = {q0, q1, q2, q3, f}
q0 = q0
Z0 = Z0
F = {f}
δ(q0, a, Z0) = (q1, AAZ0)
δ(q0, b, Z0) = (q2, BZ0)
δ(q0, ε, Z0) = (f, ε)
δ(q1, a, A) = (q1, AAA)
δ(q1, b, A) = (q1, ε)
δ(q1, ε, Z0) = (q0, Z0)
δ(q2, a, B) = (q3, ε)
δ(q2, b, B) = (q2, BB)
δ(q2, ε, Z0) = (q0, Z0)
δ(q3, ε, B) = (q2, ε)
δ(q3, ε, Z0) = (q1, AZ0)`;

    expect(rows(text)).toEqual([
      ["q0", "a", "Z0", "q1", "A A Z0"],
      ["q0", "b", "Z0", "q2", "B Z0"],
      ["q0", "", "Z0", "f", ""],
      ["q1", "a", "A", "q1", "A A A"],
      ["q1", "b", "A", "q1", ""],
      ["q1", "", "Z0", "q0", "Z0"],
      ["q2", "a", "B", "q3", ""],
      ["q2", "b", "B", "q2", "B B"],
      ["q2", "", "Z0", "q0", "Z0"],
      ["q3", "", "B", "q2", ""],
      ["q3", "", "Z0", "q1", "A Z0"],
    ]);
  });
});

describe("parseFormalText stack strings", () => {
  const header = "Q = {q0, q1}\nq0 = q0\nF = {q1}\n";

  it("reads λ as empty in the input, pop and push", () => {
    const result = parseFormalText(`${header}δ(q0, λ, λ) = (q1, λ)`);
    expect(result.model.transitions[0]).toEqual({ from: "q0", input: null, pop: [], to: "q1", push: [] });
  });

  it("reads NZ as N over Z", () => {
    const result = parseFormalText(`${header}δ(q0, a, Z) = (q1, NZ)`);
    expect(result.model.transitions[0].push).toEqual(["N", "Z"]);
  });

  it("uses the machine's known stack symbols", () => {
    const result = parseFormalText(`${header}δ(q0, a, Z0) = (q1, AAZ0)`, ["A", "Z0"]);
    expect(result.model.transitions[0].pop).toEqual(["Z0"]);
    expect(result.model.transitions[0].push).toEqual(["A", "A", "Z0"]);
  });

  it("uses the definition's own Z0 line, wherever it is written", () => {
    const result = parseFormalText(`${header}δ(q0, a, Z0) = (q1, AAZ0)\nZ0 = Z0`);
    expect(result.model.transitions[0].pop).toEqual(["Z0"]);
    expect(result.model.transitions[0].push).toEqual(["A", "A", "Z0"]);
  });
});

describe("parseFormalText", () => {
  it("reads the Z0 line back as the initial stack symbol", () => {
    const result = parseFormalText("Q = {q0}\nq0 = q0\nZ0 = A\nF = {}");
    expect(result.ok).toBe(true);
    expect(result.model.initialStackSymbol).toBe("A");
  });

  it("reads a blank Z0 line as a blank symbol, not as a missing line", () => {
    const result = parseFormalText("Q = {q0}\nq0 = q0\nZ0 =\nF = {}");
    expect(result.ok).toBe(true);
    expect(result.model.initialStackSymbol).toBe("");
  });

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
