import { describe, expect, it, vi } from "vitest";
import { TmDocStore } from "./TmDocStore.js";

function fakeClient(overrides = {}) {
  return {
    tmSnapshot: vi.fn(),
    tmApply: vi.fn(),
    tmUndo: vi.fn(),
    tmRedo: vi.fn(),
    ...overrides,
  };
}

const emptySnapshot = {
  revision: 0,
  states: [],
  transitions: [],
  derived: { alphabet: [], tape_count: 0, deterministic: true, unreachable: [] },
};

describe("TmDocStore.load", () => {
  it("populates states, transitions, revision and derived facts from a snapshot", async () => {
    const snapshot = {
      revision: 3,
      states: [{ id: 1, label: "q0", x: 10, y: 20, initial: true, accepting: true }],
      transitions: [{ id: 1, from: 1, to: 1, tapes: [{ read: "a", write: "b", direction: "R" }] }],
      derived: { alphabet: ["a", "b"], tape_count: 1, deterministic: true, unreachable: [] },
    };
    const client = fakeClient({ tmSnapshot: vi.fn().mockResolvedValue(snapshot) });
    const store = new TmDocStore(client);

    await store.load();

    expect(store.revision).toBe(3);
    expect(store.getStates()).toEqual(snapshot.states);
    expect(store.getTransitions()).toEqual(snapshot.transitions);
    expect(store.derived).toEqual(snapshot.derived);
  });

  it("notifies subscribers", async () => {
    const client = fakeClient({ tmSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new TmDocStore(client);
    const listener = vi.fn();
    store.subscribe(listener);

    await store.load();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("TmDocStore.getTransitionsBetween", () => {
  it("returns every transition sharing a (from,to) pair, sorted by id", async () => {
    const client = fakeClient({
      tmSnapshot: vi.fn().mockResolvedValue({
        revision: 1,
        states: [
          { id: 1, label: "q0", x: 0, y: 0, initial: true, accepting: false },
          { id: 2, label: "q1", x: 10, y: 0, initial: false, accepting: true },
        ],
        transitions: [
          { id: 5, from: 1, to: 2, tapes: [{ read: "b", write: "b", direction: "S" }] },
          { id: 2, from: 1, to: 2, tapes: [{ read: "a", write: "a", direction: "S" }] },
          { id: 3, from: 2, to: 1, tapes: [{ read: "c", write: "c", direction: "S" }] },
        ],
        derived: emptySnapshot.derived,
      }),
    });
    const store = new TmDocStore(client);
    await store.load();

    expect(store.getTransitionsBetween(1, 2).map((t) => t.id)).toEqual([2, 5]);
    expect(store.getTransitionsBetween(2, 1).map((t) => t.id)).toEqual([3]);
  });
});

describe("TmDocStore.apply", () => {
  it("sends ops through the client and applies the returned patch diff", async () => {
    const client = fakeClient({ tmSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new TmDocStore(client);
    await store.load();

    client.tmApply.mockResolvedValue({
      revision: 1,
      patches: [{ patch: "StateAdded", id: 5, label: "q0", x: 1, y: 2 }],
      derived: emptySnapshot.derived,
    });

    const ops = [{ op: "AddState", label: "q0", x: 1, y: 2 }];
    await store.apply(ops);

    expect(client.tmApply).toHaveBeenCalledWith(ops);
    expect(store.revision).toBe(1);
    expect(store.getStates()).toEqual([{ id: 5, label: "q0", x: 1, y: 2, initial: false, accepting: false }]);
  });

  it("applies every TmDocPatch variant to the local mirror, including DerivedSet (covers tape_count too, unlike PDA's AlphabetSet)", async () => {
    const client = fakeClient({ tmSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new TmDocStore(client);
    await store.load();

    client.tmApply.mockResolvedValue({
      revision: 1,
      patches: [
        { patch: "StateAdded", id: 1, label: "q0", x: 0, y: 0 },
        { patch: "StateAdded", id: 2, label: "q1", x: 5, y: 5 },
        { patch: "StateInitialSet", id: 1, initial: true },
        { patch: "StateAcceptingSet", id: 2, accepting: true },
        {
          patch: "TransitionAdded",
          id: 1,
          from: 1,
          to: 2,
          tapes: [{ read: "a", write: "b", direction: "R" }],
        },
        { patch: "DerivedSet", alphabet: ["a", "b"], tape_count: 1 },
      ],
      derived: { alphabet: ["a", "b"], tape_count: 1, deterministic: true, unreachable: [] },
    });
    await store.apply([]);

    expect(store.getStates()).toEqual([
      { id: 1, label: "q0", x: 0, y: 0, initial: true, accepting: false },
      { id: 2, label: "q1", x: 5, y: 5, initial: false, accepting: true },
    ]);
    expect(store.getTransitions()).toEqual([
      { id: 1, from: 1, to: 2, tapes: [{ read: "a", write: "b", direction: "R" }] },
    ]);

    client.tmApply.mockResolvedValue({
      revision: 2,
      patches: [{ patch: "TransitionEdited", id: 1, tapes: [{ read: "c", write: "d", direction: "L" }] }],
      derived: store.derived,
    });
    await store.apply([]);
    expect(store.getTransition(1)).toEqual({ id: 1, from: 1, to: 2, tapes: [{ read: "c", write: "d", direction: "L" }] });

    client.tmApply.mockResolvedValue({
      revision: 3,
      patches: [{ patch: "TransitionRemoved", id: 1 }, { patch: "StateRemoved", id: 1 }],
      derived: store.derived,
    });
    await store.apply([]);
    expect(store.getTransitions()).toEqual([]);
    expect(store.getState(1)).toBeUndefined();
  });

  it("adds a second transition sharing the same (from,to) pair without disturbing the first", async () => {
    const client = fakeClient({ tmSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new TmDocStore(client);
    await store.load();

    client.tmApply.mockResolvedValue({
      revision: 1,
      patches: [
        { patch: "StateAdded", id: 1, label: "q0", x: 0, y: 0 },
        { patch: "StateAdded", id: 2, label: "q1", x: 10, y: 0 },
        { patch: "TransitionAdded", id: 1, from: 1, to: 2, tapes: [{ read: "a", write: "a", direction: "S" }] },
      ],
      derived: emptySnapshot.derived,
    });
    await store.apply([]);

    client.tmApply.mockResolvedValue({
      revision: 2,
      patches: [{ patch: "TransitionAdded", id: 2, from: 1, to: 2, tapes: [{ read: "b", write: "b", direction: "S" }] }],
      derived: emptySnapshot.derived,
    });
    await store.apply([]);

    expect(store.getTransitionsBetween(1, 2)).toEqual([
      { id: 1, from: 1, to: 2, tapes: [{ read: "a", write: "a", direction: "S" }] },
      { id: 2, from: 1, to: 2, tapes: [{ read: "b", write: "b", direction: "S" }] },
    ]);
  });

  it("triggers a full resync when the returned revision is not the expected next one", async () => {
    const client = fakeClient({ tmSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new TmDocStore(client);
    await store.load();

    const resyncSnapshot = {
      revision: 42,
      states: [{ id: 9, label: "q9", x: 0, y: 0, initial: true, accepting: false }],
      transitions: [],
      derived: emptySnapshot.derived,
    };
    client.tmSnapshot.mockResolvedValue(resyncSnapshot);
    client.tmApply.mockResolvedValue({
      revision: 7,
      patches: [{ patch: "StateAdded", id: 1, label: "should-be-ignored", x: 0, y: 0 }],
      derived: emptySnapshot.derived,
    });

    await store.apply([{ op: "AddState", label: "x", x: 0, y: 0 }]);

    expect(client.tmSnapshot).toHaveBeenCalledTimes(2);
    expect(store.revision).toBe(42);
    expect(store.getStates()).toEqual(resyncSnapshot.states);
  });
});

describe("TmDocStore.undo / redo", () => {
  it("applies the patch diff when the server returns a result", async () => {
    const client = fakeClient({ tmSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new TmDocStore(client);
    await store.load();

    client.tmUndo.mockResolvedValue({
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
    const client = fakeClient({ tmSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new TmDocStore(client);
    await store.load();
    const listener = vi.fn();
    store.subscribe(listener);

    client.tmUndo.mockResolvedValue(null);
    expect(await store.undo()).toBeNull();
    expect(listener).not.toHaveBeenCalled();

    client.tmRedo.mockResolvedValue(null);
    expect(await store.redo()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("TmDocStore.subscribe", () => {
  it("returns an unsubscribe function", async () => {
    const client = fakeClient({ tmSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new TmDocStore(client);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    await store.load();

    expect(listener).not.toHaveBeenCalled();
  });
});
