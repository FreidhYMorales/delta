import { beforeEach, describe, expect, it, vi } from "vitest";
import { PdaDocStore } from "./PdaDocStore.js";
import { applyPdaModel } from "./applyPdaModel.js";

function snapshot() {
  return {
    revision: 1,
    states: [{ id: 1, label: "q0", x: 0, y: 0, initial: true, accepting: false }],
    transitions: [],
    derived: { input_alphabet: [], stack_alphabet: [], deterministic: true, unreachable: [] },
  };
}

async function setup() {
  const snap = snapshot();
  const client = {
    pdaSnapshot: vi.fn().mockResolvedValue(snap),
    pdaApply: vi.fn(async (ops) => {
      if (ops.some((op) => op.op === "AddState")) {
        return {
          revision: 2,
          patches: ops
            .filter((op) => op.op === "AddState")
            .map((op, i) => ({ patch: "StateAdded", id: 100 + i, label: op.label, x: op.x, y: op.y })),
          derived: snap.derived,
        };
      }
      return { revision: 3, patches: [], derived: snap.derived };
    }),
    pdaUndo: vi.fn(),
    pdaRedo: vi.fn(),
  };
  const docStore = new PdaDocStore(client);
  await docStore.load();
  return { client, docStore };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("applyPdaModel initial stack symbol", () => {
  const unchangedMachine = { states: ["q0"], initial: "q0", accepting: [], transitions: [] };
  const editsSent = (client) => client.pdaApply.mock.calls.flatMap(([ops]) => ops);

  it("changes the machine's symbol when the definition sets a different one", async () => {
    const { client, docStore } = await setup();

    await applyPdaModel(docStore, { ...unchangedMachine, initialStackSymbol: "A" });

    expect(editsSent(client)).toEqual([{ op: "SetInitialStackSymbol", symbol: "A" }]);
  });

  it("leaves the machine's symbol alone when the definition has no Z0 line", async () => {
    const { client, docStore } = await setup();

    await applyPdaModel(docStore, unchangedMachine);

    expect(editsSent(client)).toEqual([]);
  });

  it("does not record an edit when the definition repeats the current symbol", async () => {
    const { client, docStore } = await setup();

    await applyPdaModel(docStore, { ...unchangedMachine, initialStackSymbol: "Z" });

    expect(editsSent(client)).toEqual([]);
  });
});

describe("applyPdaModel", () => {
  it("creates a new state from Q, then adds a transition referencing it", async () => {
    const { client, docStore } = await setup();
    const model = {
      states: ["q0", "q1"],
      initial: "q0",
      accepting: [],
      transitions: [{ from: "q0", input: "a", pop: [], to: "q1", push: [] }],
    };
    await applyPdaModel(docStore, model);

    const addStateCall = client.pdaApply.mock.calls.find((c) => c[0].some((op) => op.op === "AddState"));
    expect(addStateCall[0]).toEqual([{ op: "AddState", label: "q1", x: expect.any(Number), y: expect.any(Number) }]);

    const addTransitionCall = client.pdaApply.mock.calls.find((c) => c[0].some((op) => op.op === "AddTransition"));
    expect(addTransitionCall[0]).toEqual(
      expect.arrayContaining([{ op: "AddTransition", from: 1, to: 100, input: "a", pop: [], push: [] }]),
    );
  });

  it("removes a state dropped from Q", async () => {
    const { client, docStore } = await setup();
    await applyPdaModel(docStore, { states: [], initial: null, accepting: [], transitions: [] });

    expect(client.pdaApply).toHaveBeenCalledWith([{ op: "RemoveState", id: 1 }]);
  });
});
