import { describe, expect, it, vi } from "vitest";
import { MooreDocStore } from "./MooreDocStore.js";

function fakeClient(overrides = {}) {
  return {
    mooreSnapshot: vi.fn(),
    mooreApply: vi.fn(),
    mooreUndo: vi.fn(),
    mooreRedo: vi.fn(),
    ...overrides,
  };
}

const emptySnapshot = {
  revision: 0,
  states: [],
  edges: [],
  derived: { input_alphabet: [], output_alphabet: [], deterministic: true, unreachable: [] },
};

describe("MooreDocStore.load", () => {
  it("populates state, edges, revision and derived facts from a snapshot", async () => {
    const snapshot = {
      revision: 3,
      states: [{ id: 1, label: "q0", x: 10, y: 20, initial: true, output: "even" }],
      edges: [{ from: 1, to: 1, inputs: ["a"] }],
      derived: { input_alphabet: ["a"], output_alphabet: ["even"], deterministic: true, unreachable: [] },
    };
    const client = fakeClient({ mooreSnapshot: vi.fn().mockResolvedValue(snapshot) });
    const store = new MooreDocStore(client);

    await store.load();

    expect(store.revision).toBe(3);
    expect(store.getStates()).toEqual(snapshot.states);
    expect(store.getEdges()).toEqual(snapshot.edges);
    expect(store.derived).toEqual(snapshot.derived);
  });

  it("notifies subscribers", async () => {
    const client = fakeClient({ mooreSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new MooreDocStore(client);
    const listener = vi.fn();
    store.subscribe(listener);

    await store.load();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("MooreDocStore.apply", () => {
  it("sends ops through the client and applies the returned patch diff", async () => {
    const client = fakeClient({ mooreSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new MooreDocStore(client);
    await store.load();

    client.mooreApply.mockResolvedValue({
      revision: 1,
      patches: [{ patch: "StateAdded", id: 5, label: "q0", x: 1, y: 2 }],
      derived: { input_alphabet: [], output_alphabet: [], deterministic: true, unreachable: [] },
    });

    const ops = [{ op: "AddState", label: "q0", x: 1, y: 2 }];
    await store.apply(ops);

    expect(client.mooreApply).toHaveBeenCalledWith(ops);
    expect(store.revision).toBe(1);
    expect(store.getStates()).toEqual([{ id: 5, label: "q0", x: 1, y: 2, initial: false, output: null }]);
  });

  it("applies every MooreDocPatch variant to the local mirror, including StateOutputSet (no Mealy equivalent)", async () => {
    const client = fakeClient({ mooreSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new MooreDocStore(client);
    await store.load();

    client.mooreApply.mockResolvedValue({
      revision: 1,
      patches: [
        { patch: "StateAdded", id: 1, label: "q0", x: 0, y: 0 },
        { patch: "StateAdded", id: 2, label: "q1", x: 5, y: 5 },
        { patch: "StateInitialSet", id: 1, initial: true },
        { patch: "StateOutputSet", id: 1, output: "even" },
        { patch: "EdgeInputsSet", from: 1, to: 2, inputs: ["a", "b"] },
        { patch: "AlphabetSet", input: ["a", "b"], output: ["even"] },
      ],
      derived: { input_alphabet: ["a", "b"], output_alphabet: ["even"], deterministic: true, unreachable: [] },
    });
    await store.apply([]);

    expect(store.getStates()).toEqual([
      { id: 1, label: "q0", x: 0, y: 0, initial: true, output: "even" },
      { id: 2, label: "q1", x: 5, y: 5, initial: false, output: null },
    ]);
    expect(store.getEdges()).toEqual([{ from: 1, to: 2, inputs: ["a", "b"] }]);

    client.mooreApply.mockResolvedValue({
      revision: 2,
      patches: [
        { patch: "StateMoved", id: 2, x: 9, y: 9 },
        { patch: "StateRenamed", id: 2, label: "q1renamed" },
      ],
      derived: store.derived,
    });
    await store.apply([]);
    expect(store.getState(2)).toEqual({ id: 2, label: "q1renamed", x: 9, y: 9, initial: false, output: null });

    client.mooreApply.mockResolvedValue({
      revision: 3,
      patches: [{ patch: "EdgeRemoved", from: 1, to: 2 }, { patch: "StateRemoved", id: 1 }],
      derived: store.derived,
    });
    await store.apply([]);
    expect(store.getEdges()).toEqual([]);
    expect(store.getState(1)).toBeUndefined();
  });

  it("triggers a full resync when the returned revision is not the expected next one", async () => {
    const client = fakeClient({ mooreSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new MooreDocStore(client);
    await store.load();

    const resyncSnapshot = {
      revision: 42,
      states: [{ id: 9, label: "q9", x: 0, y: 0, initial: true, output: null }],
      edges: [],
      derived: { input_alphabet: [], output_alphabet: [], deterministic: true, unreachable: [] },
    };
    client.mooreSnapshot.mockResolvedValue(resyncSnapshot);
    client.mooreApply.mockResolvedValue({
      revision: 7,
      patches: [{ patch: "StateAdded", id: 1, label: "should-be-ignored", x: 0, y: 0 }],
      derived: emptySnapshot.derived,
    });

    await store.apply([{ op: "AddState", label: "x", x: 0, y: 0 }]);

    expect(client.mooreSnapshot).toHaveBeenCalledTimes(2);
    expect(store.revision).toBe(42);
    expect(store.getStates()).toEqual(resyncSnapshot.states);
  });
});

describe("MooreDocStore.undo / redo", () => {
  it("applies the patch diff when the server returns a result", async () => {
    const client = fakeClient({ mooreSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new MooreDocStore(client);
    await store.load();

    client.mooreUndo.mockResolvedValue({
      revision: 1,
      patches: [{ patch: "StateAdded", id: 1, label: "q0", x: 0, y: 0 }],
      derived: emptySnapshot.derived,
    });

    const result = await store.undo();

    expect(result).not.toBeNull();
    expect(store.revision).toBe(1);
    expect(store.getStates()).toHaveLength(1);
  });

  it("is a no-op that does not notify when there is nothing to undo/redo", async () => {
    const client = fakeClient({ mooreSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new MooreDocStore(client);
    await store.load();
    const listener = vi.fn();
    store.subscribe(listener);

    client.mooreUndo.mockResolvedValue(null);
    expect(await store.undo()).toBeNull();
    expect(listener).not.toHaveBeenCalled();

    client.mooreRedo.mockResolvedValue(null);
    expect(await store.redo()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("MooreDocStore.subscribe", () => {
  it("returns an unsubscribe function", async () => {
    const client = fakeClient({ mooreSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new MooreDocStore(client);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    await store.load();

    expect(listener).not.toHaveBeenCalled();
  });
});
