import { describe, expect, it, vi } from "vitest";
import { THOMPSON_PIECES, insertThompsonPiece } from "./thompsonPieces.js";

/** In-memory stand-in for `DocStore`: applies the handful of ops piece
 * insertion uses and reports `StateAdded` patches like the real one. */
function fakeDocStore(initialStates = [], initialEdges = []) {
  const states = new Map(initialStates.map((s) => [s.id, { initial: false, accepting: false, ...s }]));
  const edges = new Map(initialEdges.map((e) => [`${e.from}:${e.to}`, { epsilon: false, symbols: [], ...e }]));
  let nextId = Math.max(-1, ...states.keys()) + 1;
  return {
    states,
    edges,
    getStates: () => [...states.values()],
    getState: (id) => states.get(id),
    getEdges: () => [...edges.values()],
    getEdge: (from, to) => edges.get(`${from}:${to}`),
    apply: vi.fn(async (ops) => {
      const patches = [];
      for (const op of ops) {
        if (op.op === "AddState") {
          const id = nextId++;
          states.set(id, { id, label: op.label, x: op.x, y: op.y, initial: false, accepting: false });
          patches.push({ patch: "StateAdded", id, label: op.label, x: op.x, y: op.y });
        } else if (op.op === "SetEdge") {
          const key = `${op.from}:${op.to}`;
          if (!op.epsilon && op.symbols.length === 0) edges.delete(key);
          else edges.set(key, { from: op.from, to: op.to, epsilon: op.epsilon, symbols: op.symbols });
        } else if (op.op === "SetInitial") {
          for (const s of states.values()) s.initial = s.id === op.id;
        } else if (op.op === "SetAccepting") {
          states.get(op.id).accepting = op.accepting;
        } else {
          throw new Error(`unexpected op ${op.op}`);
        }
      }
      return { patches };
    }),
  };
}

function fakeCtx(docStore, answers, selection = null) {
  const queue = [...answers];
  return {
    docStore,
    selection,
    setSelection: vi.fn(),
    promptSymbol: vi.fn(async () => queue.shift()),
    layout: { arrange: vi.fn() },
  };
}

/** Edges as "from-label -sym-> to-label" strings, ε for epsilon. */
function describeEdges(doc) {
  const label = (id) => doc.states.get(id).label;
  return doc
    .getEdges()
    .map((e) => `${label(e.from)} -${e.epsilon ? "ε" : e.symbols.join(",")}-> ${label(e.to)}`)
    .sort();
}

describe("THOMPSON_PIECES", () => {
  it("defines the five pieces of the Thompson nomenclature", () => {
    expect(THOMPSON_PIECES.map((p) => p.notation)).toEqual(["r", "rs", "r|s", "r*", "r+"]);
  });
});

describe("insertThompsonPiece — standalone (nothing selected)", () => {
  it("r: two states joined by the value typed for r", async () => {
    const doc = fakeDocStore();
    await insertThompsonPiece(fakeCtx(doc, ["a"]), "symbol");
    expect(describeEdges(doc)).toEqual(["q0 -a-> q1"]);
  });

  it("rs: three states, the middle one shared between r and s (no ε between them)", async () => {
    const doc = fakeDocStore();
    await insertThompsonPiece(fakeCtx(doc, ["a", "b"]), "concat");
    expect(doc.states.size).toBe(3);
    expect(describeEdges(doc)).toEqual(["q0 -a-> q1", "q1 -b-> q2"]);
  });

  it("r|s: fork and join joined to each branch by ε", async () => {
    const doc = fakeDocStore();
    await insertThompsonPiece(fakeCtx(doc, ["a", "b"]), "union");
    expect(doc.states.size).toBe(6);
    expect(describeEdges(doc)).toEqual([
      "q0 -ε-> q1",
      "q0 -ε-> q3",
      "q1 -a-> q2",
      "q2 -ε-> q5",
      "q3 -b-> q4",
      "q4 -ε-> q5",
    ]);
  });

  it("r*: loop back from r's end to its start, plus the ε bypass", async () => {
    const doc = fakeDocStore();
    await insertThompsonPiece(fakeCtx(doc, ["a"]), "star");
    expect(describeEdges(doc)).toEqual(["q0 -ε-> q1", "q0 -ε-> q3", "q1 -a-> q2", "q2 -ε-> q1", "q2 -ε-> q3"]);
  });

  it("r+: like r* but without the bypass", async () => {
    const doc = fakeDocStore();
    await insertThompsonPiece(fakeCtx(doc, ["a"]), "plus");
    expect(describeEdges(doc)).toEqual(["q0 -ε-> q1", "q1 -a-> q2", "q2 -ε-> q1", "q2 -ε-> q3"]);
  });

  it("a blank value makes that transition ε", async () => {
    const doc = fakeDocStore();
    await insertThompsonPiece(fakeCtx(doc, [""]), "symbol");
    expect(describeEdges(doc)).toEqual(["q0 -ε-> q1"]);
  });

  it("on an empty canvas, marks the piece's entry initial and its exit accepting", async () => {
    const doc = fakeDocStore();
    await insertThompsonPiece(fakeCtx(doc, ["a", "b"]), "concat");
    const byLabel = new Map(doc.getStates().map((s) => [s.label, s]));
    expect(byLabel.get("q0").initial).toBe(true);
    expect(byLabel.get("q2").accepting).toBe(true);
    expect(byLabel.get("q1").accepting).toBe(false);
  });

  it("next to existing states: leaves initial/accepting alone and places the piece to the right", async () => {
    const doc = fakeDocStore([{ id: 0, label: "q0", x: 100, y: 200, initial: true }]);
    await insertThompsonPiece(fakeCtx(doc, ["a"]), "symbol");
    const added = doc.getStates().filter((s) => s.id !== 0);
    expect(added.every((s) => !s.initial && !s.accepting)).toBe(true);
    expect(Math.min(...added.map((s) => s.x))).toBeGreaterThan(100);
    expect(doc.states.get(0).initial).toBe(true);
  });

  it("does nothing when the value prompt is cancelled", async () => {
    const doc = fakeDocStore();
    await insertThompsonPiece(fakeCtx(doc, ["a", null]), "union");
    expect(doc.apply).not.toHaveBeenCalled();
    expect(doc.states.size).toBe(0);
  });
});

describe("insertThompsonPiece — nested (a transition selected)", () => {
  it("replaces the selected transition: its source becomes the piece's entry and its target the piece's exit", async () => {
    // q0 -x-> q1, then insert r* into that transition.
    const doc = fakeDocStore(
      [
        { id: 0, label: "q0", x: 0, y: 0, initial: true },
        { id: 1, label: "q1", x: 160, y: 0, accepting: true },
      ],
      [{ from: 0, to: 1, symbols: ["x"] }],
    );
    const ctx = fakeCtx(doc, ["a"], { kind: "edge", from: 0, to: 1 });
    await insertThompsonPiece(ctx, "star");

    expect(doc.states.size).toBe(4); // only r*'s two inner states are new
    expect(describeEdges(doc)).toEqual(["q0 -ε-> q1", "q0 -ε-> q2", "q2 -a-> q3", "q3 -ε-> q1", "q3 -ε-> q2"]);
    expect(doc.states.get(0).initial).toBe(true);
    expect(doc.states.get(1).accepting).toBe(true);
    expect(ctx.layout.arrange).toHaveBeenCalled();
  });

  it("nests a piece inside a branch of another piece: (a*)|b", async () => {
    const doc = fakeDocStore();
    await insertThompsonPiece(fakeCtx(doc, ["a", "b"]), "union");
    const upper = doc.getEdges().find((e) => e.symbols[0] === "a");
    await insertThompsonPiece(fakeCtx(doc, ["a"], { kind: "edge", from: upper.from, to: upper.to }), "star");

    expect(doc.states.size).toBe(8);
    expect(describeEdges(doc)).toEqual([
      "q0 -ε-> q1",
      "q0 -ε-> q3",
      "q1 -ε-> q2",
      "q1 -ε-> q6",
      "q2 -ε-> q5",
      "q3 -b-> q4",
      "q4 -ε-> q5",
      "q6 -a-> q7",
      "q7 -ε-> q2",
      "q7 -ε-> q6",
    ]);
  });

  it("refuses a self-loop (entry and exit can't be the same state) without touching the document", async () => {
    const doc = fakeDocStore([{ id: 0, label: "q0", x: 0, y: 0 }], [{ from: 0, to: 0, symbols: ["x"] }]);
    const ctx = fakeCtx(doc, ["a"], { kind: "edge", from: 0, to: 0 });
    await expect(insertThompsonPiece(ctx, "symbol")).rejects.toThrow(/bucle/);
    expect(doc.apply).not.toHaveBeenCalled();
  });
});
