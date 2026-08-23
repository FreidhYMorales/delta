import { describe, expect, it, vi } from "vitest";
import { PdaDocStore } from "./PdaDocStore.js";

function fakeClient(overrides = {}) {
  return {
    pdaSnapshot: vi.fn(),
    pdaApply: vi.fn(),
    pdaUndo: vi.fn(),
    pdaRedo: vi.fn(),
    ...overrides,
  };
}

const emptySnapshot = {
  revision: 0,
  states: [],
  transitions: [],
  derived: { input_alphabet: [], stack_alphabet: [], deterministic: true, unreachable: [] },
};

describe("PdaDocStore.load", () => {
  it("populates states, transitions, revision and derived facts from a snapshot", async () => {
    const snapshot = {
      revision: 3,
      states: [{ id: 1, label: "q0", x: 10, y: 20, initial: true, accepting: true }],
      transitions: [{ id: 1, from: 1, to: 1, input: "a", pop: ["Z"], push: ["A", "Z"] }],
      derived: { input_alphabet: ["a"], stack_alphabet: ["A", "Z"], deterministic: true, unreachable: [] },
    };
    const client = fakeClient({ pdaSnapshot: vi.fn().mockResolvedValue(snapshot) });
    const store = new PdaDocStore(client);

    await store.load();

    expect(store.revision).toBe(3);
    expect(store.getStates()).toEqual(snapshot.states);
    expect(store.getTransitions()).toEqual(snapshot.transitions);
    expect(store.derived).toEqual(snapshot.derived);
  });

  it("notifies subscribers", async () => {
    const client = fakeClient({ pdaSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new PdaDocStore(client);
    const listener = vi.fn();
    store.subscribe(listener);

    await store.load();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("PdaDocStore.getTransitionsBetween", () => {
  it("returns every transition sharing a (from,to) pair, sorted by id", async () => {
    const client = fakeClient({
      pdaSnapshot: vi.fn().mockResolvedValue({
        revision: 1,
        states: [
          { id: 1, label: "q0", x: 0, y: 0, initial: true, accepting: false },
          { id: 2, label: "q1", x: 10, y: 0, initial: false, accepting: true },
        ],
        transitions: [
          { id: 5, from: 1, to: 2, input: "b", pop: [], push: [] },
          { id: 2, from: 1, to: 2, input: "a", pop: [], push: [] },
          { id: 3, from: 2, to: 1, input: "c", pop: [], push: [] },
        ],
        derived: emptySnapshot.derived,
      }),
    });
    const store = new PdaDocStore(client);
    await store.load();

    expect(store.getTransitionsBetween(1, 2).map((t) => t.id)).toEqual([2, 5]);
    expect(store.getTransitionsBetween(2, 1).map((t) => t.id)).toEqual([3]);
  });
});

describe("PdaDocStore.apply", () => {
  it("sends ops through the client and applies the returned patch diff", async () => {
    const client = fakeClient({ pdaSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new PdaDocStore(client);
    await store.load();

    client.pdaApply.mockResolvedValue({
      revision: 1,
      patches: [{ patch: "StateAdded", id: 5, label: "q0", x: 1, y: 2 }],
      derived: emptySnapshot.derived,
    });

    const ops = [{ op: "AddState", label: "q0", x: 1, y: 2 }];
    await store.apply(ops);

    expect(client.pdaApply).toHaveBeenCalledWith(ops);
    expect(store.revision).toBe(1);
    expect(store.getStates()).toEqual([{ id: 5, label: "q0", x: 1, y: 2, initial: false, accepting: false }]);
  });

  it("applies every PdaDocPatch variant to the local mirror, including StateAcceptingSet (no Mealy/Moore equivalent)", async () => {
    const client = fakeClient({ pdaSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new PdaDocStore(client);
    await store.load();

    client.pdaApply.mockResolvedValue({
      revision: 1,
      patches: [
        { patch: "StateAdded", id: 1, label: "q0", x: 0, y: 0 },
        { patch: "StateAdded", id: 2, label: "q1", x: 5, y: 5 },
        { patch: "StateInitialSet", id: 1, initial: true },
        { patch: "StateAcceptingSet", id: 2, accepting: true },
        { patch: "TransitionAdded", id: 1, from: 1, to: 2, input: "a", pop: ["Z"], push: ["A", "Z"] },
        { patch: "AlphabetSet", input: ["a"], stack: ["A", "Z"] },
      ],
      derived: { input_alphabet: ["a"], stack_alphabet: ["A", "Z"], deterministic: true, unreachable: [] },
    });
    await store.apply([]);

    expect(store.getStates()).toEqual([
      { id: 1, label: "q0", x: 0, y: 0, initial: true, accepting: false },
      { id: 2, label: "q1", x: 5, y: 5, initial: false, accepting: true },
    ]);
    expect(store.getTransitions()).toEqual([{ id: 1, from: 1, to: 2, input: "a", pop: ["Z"], push: ["A", "Z"] }]);

    client.pdaApply.mockResolvedValue({
      revision: 2,
      patches: [{ patch: "TransitionEdited", id: 1, input: "b", pop: [], push: [] }],
      derived: store.derived,
    });
    await store.apply([]);
    expect(store.getTransition(1)).toEqual({ id: 1, from: 1, to: 2, input: "b", pop: [], push: [] });

    client.pdaApply.mockResolvedValue({
      revision: 3,
      patches: [{ patch: "TransitionRemoved", id: 1 }, { patch: "StateRemoved", id: 1 }],
      derived: store.derived,
    });
    await store.apply([]);
    expect(store.getTransitions()).toEqual([]);
    expect(store.getState(1)).toBeUndefined();
  });

  it("adds a second transition sharing the same (from,to) pair without disturbing the first", async () => {
    const client = fakeClient({ pdaSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new PdaDocStore(client);
    await store.load();

    client.pdaApply.mockResolvedValue({
      revision: 1,
      patches: [
        { patch: "StateAdded", id: 1, label: "q0", x: 0, y: 0 },
        { patch: "StateAdded", id: 2, label: "q1", x: 10, y: 0 },
        { patch: "TransitionAdded", id: 1, from: 1, to: 2, input: "a", pop: [], push: [] },
      ],
      derived: emptySnapshot.derived,
    });
    await store.apply([]);

    client.pdaApply.mockResolvedValue({
      revision: 2,
      patches: [{ patch: "TransitionAdded", id: 2, from: 1, to: 2, input: "b", pop: [], push: [] }],
      derived: emptySnapshot.derived,
    });
    await store.apply([]);

    expect(store.getTransitionsBetween(1, 2)).toEqual([
      { id: 1, from: 1, to: 2, input: "a", pop: [], push: [] },
      { id: 2, from: 1, to: 2, input: "b", pop: [], push: [] },
    ]);
  });

  it("triggers a full resync when the returned revision is not the expected next one", async () => {
    const client = fakeClient({ pdaSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new PdaDocStore(client);
    await store.load();

    const resyncSnapshot = {
      revision: 42,
      states: [{ id: 9, label: "q9", x: 0, y: 0, initial: true, accepting: false }],
      transitions: [],
      derived: emptySnapshot.derived,
    };
    client.pdaSnapshot.mockResolvedValue(resyncSnapshot);
    client.pdaApply.mockResolvedValue({
      revision: 7,
      patches: [{ patch: "StateAdded", id: 1, label: "should-be-ignored", x: 0, y: 0 }],
      derived: emptySnapshot.derived,
    });

    await store.apply([{ op: "AddState", label: "x", x: 0, y: 0 }]);

    expect(client.pdaSnapshot).toHaveBeenCalledTimes(2);
    expect(store.revision).toBe(42);
    expect(store.getStates()).toEqual(resyncSnapshot.states);
  });
});

describe("PdaDocStore.undo / redo", () => {
  it("applies the patch diff when the server returns a result", async () => {
    const client = fakeClient({ pdaSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new PdaDocStore(client);
    await store.load();

    client.pdaUndo.mockResolvedValue({
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
    const client = fakeClient({ pdaSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new PdaDocStore(client);
    await store.load();
    const listener = vi.fn();
    store.subscribe(listener);

    client.pdaUndo.mockResolvedValue(null);
    expect(await store.undo()).toBeNull();
    expect(listener).not.toHaveBeenCalled();

    client.pdaRedo.mockResolvedValue(null);
    expect(await store.redo()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("PdaDocStore.subscribe", () => {
  it("returns an unsubscribe function", async () => {
    const client = fakeClient({ pdaSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new PdaDocStore(client);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    await store.load();

    expect(listener).not.toHaveBeenCalled();
  });
});
