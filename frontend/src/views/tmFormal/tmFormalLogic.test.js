import { describe, expect, it } from "vitest";
import { formatFormalText, parseFormalText, planStateDiff, planSyncOps } from "./tmFormalLogic.js";

describe("formatFormalText", () => {
  it("renders Q/Gamma/q0/F, one delta(from, tapes) = to line per transition (1 tape)", () => {
    const text = formatFormalText({
      states: [
        { id: 1, label: "q0", initial: true, accepting: false },
        { id: 2, label: "q1", initial: false, accepting: true },
      ],
      transitions: [{ id: 1, from: 1, to: 2, tapes: [{ read: "a", write: "b", direction: "R" }] }],
      derived: { alphabet: ["a", "b"], tape_count: 1 },
    });

    expect(text).toContain("Q = {q0, q1}");
    expect(text).toContain("Γ = {a, b}");
    expect(text).toContain("q0 = q0");
    expect(text).toContain("F = {q1}");
    expect(text).toContain("δ(q0, a ; b , R) = q1");
    expect(text).toMatch(/#.*Cintas.*1/);
  });

  it("renders a 2-tape delta line joined with | , character-for-character the diagram's own format", () => {
    const text = formatFormalText({
      states: [
        { id: 1, label: "q0", initial: true, accepting: false },
        { id: 2, label: "q1", initial: false, accepting: false },
      ],
      transitions: [
        {
          id: 1,
          from: 1,
          to: 2,
          tapes: [
            { read: "a", write: "b", direction: "R" },
            { read: "c", write: "d", direction: "L" },
          ],
        },
      ],
      derived: { alphabet: ["a", "b", "c", "d"], tape_count: 2 },
    });
    expect(text).toContain("δ(q0, a ; b , R | c ; d , L) = q1");
    expect(text).toMatch(/#.*Cintas.*2/);
  });

  it("renders an empty F when no state is accepting", () => {
    const text = formatFormalText({
      states: [{ id: 1, label: "q0", initial: true, accepting: false }],
      transitions: [],
      derived: { alphabet: [], tape_count: 0 },
    });
    expect(text).toContain("F = {}");
  });
});

describe("parseFormalText", () => {
  it("round-trips a well-formed 1-tape definition", () => {
    const text = ["Q = {q0, q1}", "q0 = q0", "F = {q1}", "delta(q0, a ; b , R) = q1"].join("\n");
    const result = parseFormalText(text);
    expect(result.ok).toBe(true);
    expect(result.model).toEqual({
      states: ["q0", "q1"],
      initial: "q0",
      accepting: ["q1"],
      transitions: [{ from: "q0", to: "q1", tapes: [{ read: "a", write: "b", direction: "R" }] }],
    });
  });

  it("isolates fromLabel / tape-ops-blob / toLabel correctly for a 2-tape delta line (multiple commas and a |)", () => {
    const text = ["Q = {q0, q1}", "q0 = q0", "F = {}", "delta(q0, a ; b , R | c ; d , L) = q1"].join("\n");
    const result = parseFormalText(text);
    expect(result.ok).toBe(true);
    expect(result.model.transitions).toEqual([
      {
        from: "q0",
        to: "q1",
        tapes: [
          { read: "a", write: "b", direction: "R" },
          { read: "c", write: "d", direction: "L" },
        ],
      },
    ]);
  });

  it("round-trips formatFormalText's own output for a 2-tape transition", () => {
    const doc = {
      states: [
        { id: 1, label: "q0", initial: true, accepting: false },
        { id: 2, label: "q1", initial: false, accepting: true },
      ],
      transitions: [
        {
          id: 1,
          from: 1,
          to: 2,
          tapes: [
            { read: "a", write: "b", direction: "R" },
            { read: "c", write: "d", direction: "L" },
          ],
        },
      ],
      derived: { alphabet: ["a", "b", "c", "d"], tape_count: 2 },
    };
    const text = formatFormalText(doc);
    const result = parseFormalText(text);
    expect(result.ok).toBe(true);
    expect(result.model).toEqual({
      states: ["q0", "q1"],
      initial: "q0",
      accepting: ["q1"],
      transitions: [
        {
          from: "q0",
          to: "q1",
          tapes: [
            { read: "a", write: "b", direction: "R" },
            { read: "c", write: "d", direction: "L" },
          ],
        },
      ],
    });
  });

  it("ignores comment lines and informational Gamma lines", () => {
    const result = parseFormalText("Q = {q0}\nGamma = {a}\n# just a note");
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
    const result = parseFormalText("Q = {q0}\ndelta(q0, a ; b , R) = q9");
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
      transitions: [{ from: "q0", to: "q1", tapes: [{ read: "a", write: "b", direction: "R" }] }],
    };
    const ops = planSyncOps(model, resolvedIdOf, currentStates, []);
    expect(ops).toEqual(
      expect.arrayContaining([
        { op: "AddTransition", from: 1, to: 2, tapes: [{ read: "a", write: "b", direction: "R" }] },
      ]),
    );
  });

  it("emits RemoveTransition for a dropped transition", () => {
    const model = { states: ["q0", "q1"], initial: "q0", accepting: [], transitions: [] };
    const currentTransitions = [{ id: 7, from: 1, to: 2, tapes: [{ read: "a", write: "b", direction: "R" }] }];
    const ops = planSyncOps(model, resolvedIdOf, currentStates, currentTransitions);
    expect(ops).toEqual(expect.arrayContaining([{ op: "RemoveTransition", id: 7 }]));
  });

  it("emits nothing when the document already matches the model", () => {
    const tapes = [{ read: "a", write: "b", direction: "R" }];
    const model = {
      states: ["q0", "q1"],
      initial: "q0",
      accepting: [],
      transitions: [{ from: "q0", to: "q1", tapes }],
    };
    const currentTransitions = [{ id: 7, from: 1, to: 2, tapes }];
    expect(planSyncOps(model, resolvedIdOf, currentStates, currentTransitions)).toEqual([]);
  });

  it("does not collapse two transitions sharing the same (from,to) pair with different tapes", () => {
    const model = {
      states: ["q0", "q1"],
      initial: "q0",
      accepting: [],
      transitions: [
        { from: "q0", to: "q1", tapes: [{ read: "a", write: "b", direction: "R" }] },
        { from: "q0", to: "q1", tapes: [{ read: "c", write: "d", direction: "L" }] },
      ],
    };
    const ops = planSyncOps(model, resolvedIdOf, currentStates, []);
    expect(ops.filter((o) => o.op === "AddTransition")).toHaveLength(2);
    expect(ops).toEqual(
      expect.arrayContaining([
        { op: "AddTransition", from: 1, to: 2, tapes: [{ read: "a", write: "b", direction: "R" }] },
        { op: "AddTransition", from: 1, to: 2, tapes: [{ read: "c", write: "d", direction: "L" }] },
      ]),
    );
  });

  it("edits one of two same-pair transitions without disturbing the other (remove+add by tuple identity)", () => {
    const currentTransitions = [
      { id: 7, from: 1, to: 2, tapes: [{ read: "a", write: "b", direction: "R" }] },
      { id: 8, from: 1, to: 2, tapes: [{ read: "c", write: "d", direction: "L" }] },
    ];
    const model = {
      states: ["q0", "q1"],
      initial: "q0",
      accepting: [],
      transitions: [
        { from: "q0", to: "q1", tapes: [{ read: "x", write: "y", direction: "S" }] }, // "a;b,R" -> "x;y,S"
        { from: "q0", to: "q1", tapes: [{ read: "c", write: "d", direction: "L" }] }, // unchanged
      ],
    };
    const ops = planSyncOps(model, resolvedIdOf, currentStates, currentTransitions);
    expect(ops).toEqual([
      { op: "RemoveTransition", id: 7 },
      { op: "AddTransition", from: 1, to: 2, tapes: [{ read: "x", write: "y", direction: "S" }] },
    ]);
  });
});
