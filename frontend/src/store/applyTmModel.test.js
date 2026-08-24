import { beforeEach, describe, expect, it, vi } from "vitest";
import { TmDocStore } from "./TmDocStore.js";
import { applyTmModel } from "./applyTmModel.js";

function snapshot() {
  return {
    revision: 1,
    states: [{ id: 1, label: "q0", x: 0, y: 0, initial: true, accepting: false }],
    transitions: [],
    derived: { alphabet: [], tape_count: 0, deterministic: true, unreachable: [] },
  };
}

async function setup() {
  const snap = snapshot();
  const client = {
    tmSnapshot: vi.fn().mockResolvedValue(snap),
    tmApply: vi.fn(async (ops) => {
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
    tmUndo: vi.fn(),
    tmRedo: vi.fn(),
  };
  const docStore = new TmDocStore(client);
  await docStore.load();
  return { client, docStore };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("applyTmModel", () => {
  it("creates a new state from Q, then adds a transition referencing it", async () => {
    const { client, docStore } = await setup();
    const model = {
      states: ["q0", "q1"],
      initial: "q0",
      accepting: [],
      transitions: [{ from: "q0", to: "q1", tapes: [{ read: "a", write: "b", direction: "R" }] }],
    };
    await applyTmModel(docStore, model);

    const addStateCall = client.tmApply.mock.calls.find((c) => c[0].some((op) => op.op === "AddState"));
    expect(addStateCall[0]).toEqual([{ op: "AddState", label: "q1", x: expect.any(Number), y: expect.any(Number) }]);

    const addTransitionCall = client.tmApply.mock.calls.find((c) => c[0].some((op) => op.op === "AddTransition"));
    expect(addTransitionCall[0]).toEqual(
      expect.arrayContaining([
        { op: "AddTransition", from: 1, to: 100, tapes: [{ read: "a", write: "b", direction: "R" }] },
      ]),
    );
  });

  it("removes a state dropped from Q", async () => {
    const { client, docStore } = await setup();
    await applyTmModel(docStore, { states: [], initial: null, accepting: [], transitions: [] });

    expect(client.tmApply).toHaveBeenCalledWith([{ op: "RemoveState", id: 1 }]);
  });
});
