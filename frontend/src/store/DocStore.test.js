import { describe, expect, it, vi } from "vitest";
import { DocStore } from "./DocStore.js";

function fakeClient(overrides = {}) {
  return {
    docSnapshot: vi.fn(),
    docApply: vi.fn(),
    docUndo: vi.fn(),
    docRedo: vi.fn(),
    ...overrides,
  };
}

const emptySnapshot = {
  revision: 0,
  states: [],
  edges: [],
  derived: { classification: "Dfa", alphabet: [], unreachable: [] },
};

describe("DocStore.load", () => {
  it("populates state, edges, revision and derived facts from a snapshot", async () => {
    const snapshot = {
      revision: 3,
      states: [{ id: 1, label: "q0", x: 10, y: 20, initial: true, accepting: false }],
      edges: [{ from: 1, to: 1, epsilon: false, symbols: ["a"] }],
      derived: { classification: "Dfa", alphabet: ["a"], unreachable: [] },
    };
    const client = fakeClient({ docSnapshot: vi.fn().mockResolvedValue(snapshot) });
    const store = new DocStore(client);

    await store.load();

    expect(store.revision).toBe(3);
    expect(store.getStates()).toEqual(snapshot.states);
    expect(store.getEdges()).toEqual(snapshot.edges);
    expect(store.derived).toEqual(snapshot.derived);
  });

  it("notifies subscribers", async () => {
    const client = fakeClient({ docSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new DocStore(client);
    const listener = vi.fn();
    store.subscribe(listener);

    await store.load();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("DocStore.apply", () => {
  it("sends ops through the client and applies the returned patch diff", async () => {
    const client = fakeClient({ docSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new DocStore(client);
    await store.load(); // revision 0

    client.docApply.mockResolvedValue({
      revision: 1,
      patches: [{ patch: "StateAdded", id: 5, label: "q0", x: 1, y: 2 }],
      derived: { classification: "Dfa", alphabet: [], unreachable: [] },
    });

    const ops = [{ op: "AddState", label: "q0", x: 1, y: 2 }];
    await store.apply(ops);

    expect(client.docApply).toHaveBeenCalledWith(ops);
    expect(store.revision).toBe(1);
    expect(store.getStates()).toEqual([
      { id: 5, label: "q0", x: 1, y: 2, initial: false, accepting: false },
    ]);
  });

  it("applies every DocPatch variant to the local mirror", async () => {
    const client = fakeClient({ docSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new DocStore(client);
    await store.load();

    client.docApply.mockResolvedValue({
      revision: 1,
      patches: [
        { patch: "StateAdded", id: 1, label: "q0", x: 0, y: 0 },
        { patch: "StateAdded", id: 2, label: "q1", x: 5, y: 5 },
        { patch: "StateFlagsSet", id: 1, initial: true, accepting: false },
        { patch: "StateFlagsSet", id: 2, initial: false, accepting: true },
        { patch: "EdgeSymbolsSet", from: 1, to: 2, epsilon: false, symbols: ["a", "b"] },
        { patch: "AlphabetSet", symbols: ["a", "b"] },
      ],
      derived: { classification: "Dfa", alphabet: ["a", "b"], unreachable: [] },
    });
    await store.apply([]);

    expect(store.getStates()).toEqual([
      { id: 1, label: "q0", x: 0, y: 0, initial: true, accepting: false },
      { id: 2, label: "q1", x: 5, y: 5, initial: false, accepting: true },
    ]);
    expect(store.getEdges()).toEqual([{ from: 1, to: 2, epsilon: false, symbols: ["a", "b"] }]);

    client.docApply.mockResolvedValue({
      revision: 2,
      patches: [
        { patch: "StateMoved", id: 2, x: 9, y: 9 },
        { patch: "StateRenamed", id: 2, label: "q1renamed" },
      ],
      derived: store.derived,
    });
    await store.apply([]);
    expect(store.getState(2)).toEqual({
      id: 2,
      label: "q1renamed",
      x: 9,
      y: 9,
      initial: false,
      accepting: true,
    });

    client.docApply.mockResolvedValue({
      revision: 3,
      patches: [{ patch: "EdgeRemoved", from: 1, to: 2 }, { patch: "StateRemoved", id: 1 }],
      derived: store.derived,
    });
    await store.apply([]);
    expect(store.getEdges()).toEqual([]);
    expect(store.getState(1)).toBeUndefined();
  });

  it("triggers a full resync when the returned revision is not the expected next one", async () => {
    const client = fakeClient({ docSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new DocStore(client);
    await store.load(); // revision 0

    const resyncSnapshot = {
      revision: 42,
      states: [{ id: 9, label: "q9", x: 0, y: 0, initial: true, accepting: false }],
      edges: [],
      derived: { classification: "Dfa", alphabet: [], unreachable: [] },
    };
    client.docSnapshot.mockResolvedValue(resyncSnapshot);

    // Simulate an unexpected revision jump (e.g. another window/session edited).
    client.docApply.mockResolvedValue({
      revision: 7,
      patches: [{ patch: "StateAdded", id: 1, label: "should-be-ignored", x: 0, y: 0 }],
      derived: { classification: "Dfa", alphabet: [], unreachable: [] },
    });

    await store.apply([{ op: "AddState", label: "x", x: 0, y: 0 }]);

    expect(client.docSnapshot).toHaveBeenCalledTimes(2); // once in load(), once for resync
    expect(store.revision).toBe(42);
    expect(store.getStates()).toEqual(resyncSnapshot.states);
  });
});

describe("DocStore.undo / redo", () => {
  it("applies the patch diff when the server returns a result", async () => {
    const client = fakeClient({ docSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new DocStore(client);
    await store.load();

    client.docUndo.mockResolvedValue({
      revision: 1,
      patches: [{ patch: "StateAdded", id: 1, label: "q0", x: 0, y: 0 }],
      derived: { classification: "Dfa", alphabet: [], unreachable: [] },
    });

    const result = await store.undo();

    expect(result).not.toBeNull();
    expect(store.revision).toBe(1);
    expect(store.getStates()).toHaveLength(1);
  });

  it("is a no-op that does not notify when there is nothing to undo/redo", async () => {
    const client = fakeClient({ docSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new DocStore(client);
    await store.load();
    const listener = vi.fn();
    store.subscribe(listener);

    client.docUndo.mockResolvedValue(null);
    const result = await store.undo();

    expect(result).toBeNull();
    expect(store.revision).toBe(0);
    expect(listener).not.toHaveBeenCalled();

    client.docRedo.mockResolvedValue(null);
    const redoResult = await store.redo();
    expect(redoResult).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("DocStore.subscribe", () => {
  it("returns an unsubscribe function", async () => {
    const client = fakeClient({ docSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new DocStore(client);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    await store.load();

    expect(listener).not.toHaveBeenCalled();
  });
});
