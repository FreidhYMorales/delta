import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "./DocStore.js";
import { applyAutomatonModel } from "./applyAutomatonModel.js";

function snapshot() {
  return {
    revision: 1,
    states: [
      { id: 1, label: "q0", x: 0, y: 0, initial: true, accepting: false },
      { id: 2, label: "q1", x: 50, y: 0, initial: false, accepting: true },
    ],
    edges: [{ from: 1, to: 2, epsilon: false, symbols: ["a"] }],
    derived: { classification: "Dfa", alphabet: ["a"], unreachable: [] },
  };
}

async function setup() {
  const snap = snapshot();
  const client = {
    docSnapshot: vi.fn().mockResolvedValue(snap),
    docApply: vi.fn(),
    docUndo: vi.fn(),
    docRedo: vi.fn(),
  };
  const docStore = new DocStore(client);
  await docStore.load();
  return { client, docStore };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("applyAutomatonModel", () => {
  it("adds a new state, resolves its server-assigned id from the patch, then wires its edges in a second call", async () => {
    const { client, docStore } = await setup();
    client.docApply
      .mockResolvedValueOnce({
        revision: 2,
        patches: [{ patch: "StateAdded", id: 9, label: "q2", x: 140, y: 40 }],
        derived: { classification: "Dfa", alphabet: ["a", "b"], unreachable: [] },
      })
      .mockResolvedValueOnce({ revision: 3, patches: [], derived: { classification: "Dfa", alphabet: ["a", "b"], unreachable: [] } });

    await applyAutomatonModel(docStore, {
      states: ["q0", "q1", "q2"],
      initial: "q0",
      accepting: ["q1"],
      transitions: [
        { from: "q0", symbol: "a", to: "q1" },
        { from: "q1", symbol: "b", to: "q2" },
      ],
    });

    expect(client.docApply).toHaveBeenCalledTimes(2);
    expect(client.docApply.mock.calls[0][0]).toEqual([
      { op: "AddState", label: "q2", x: expect.any(Number), y: expect.any(Number) },
    ]);
    expect(client.docApply.mock.calls[1][0]).toEqual(
      expect.arrayContaining([{ op: "SetEdge", from: 2, to: 9, epsilon: false, symbols: ["b"] }]),
    );
  });

  it("removes a state no longer in the model", async () => {
    const { client, docStore } = await setup();
    // Realistic server behavior: removing a state also cascades removing
    // any edge touching it, in the same patch batch.
    client.docApply.mockResolvedValueOnce({
      revision: 2,
      patches: [{ patch: "EdgeRemoved", from: 1, to: 2 }, { patch: "StateRemoved", id: 2 }],
      derived: { classification: "Dfa", alphabet: [], unreachable: [] },
    });

    await applyAutomatonModel(docStore, { states: ["q0"], initial: "q0", accepting: [], transitions: [] });

    expect(client.docApply).toHaveBeenCalledTimes(1);
    expect(client.docApply).toHaveBeenCalledWith([{ op: "RemoveState", id: 2 }]);
  });

  it("makes zero docStore.apply calls when the model already matches the document", async () => {
    const { client, docStore } = await setup();

    await applyAutomatonModel(docStore, {
      states: ["q0", "q1"],
      initial: "q0",
      accepting: ["q1"],
      transitions: [{ from: "q0", symbol: "a", to: "q1" }],
    });

    expect(client.docApply).not.toHaveBeenCalled();
  });
});
