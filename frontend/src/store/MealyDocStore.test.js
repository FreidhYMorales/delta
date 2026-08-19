import { describe, expect, it, vi } from "vitest";
import { MealyDocStore } from "./MealyDocStore.js";

function fakeClient(overrides = {}) {
  return {
    mealySnapshot: vi.fn(),
    mealyApply: vi.fn(),
    mealyUndo: vi.fn(),
    mealyRedo: vi.fn(),
    ...overrides,
  };
}

const emptySnapshot = {
  revision: 0,
  states: [],
  edges: [],
  derived: { input_alphabet: [], output_alphabet: [], deterministic: true, unreachable: [] },
};

describe("MealyDocStore.load", () => {
  it("populates state, edges, revision and derived facts from a snapshot", async () => {
    const snapshot = {
      revision: 3,
      states: [{ id: 1, label: "q0", x: 10, y: 20, initial: true }],
      edges: [{ from: 1, to: 1, transitions: [["a", "x"]] }],
      derived: { input_alphabet: ["a"], output_alphabet: ["x"], deterministic: true, unreachable: [] },
    };
    const client = fakeClient({ mealySnapshot: vi.fn().mockResolvedValue(snapshot) });
    const store = new MealyDocStore(client);

    await store.load();

    expect(store.revision).toBe(3);
    expect(store.getStates()).toEqual(snapshot.states);
    expect(store.getEdges()).toEqual(snapshot.edges);
    expect(store.derived).toEqual(snapshot.derived);
  });

  it("notifies subscribers", async () => {
    const client = fakeClient({ mealySnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new MealyDocStore(client);
    const listener = vi.fn();
    store.subscribe(listener);

    await store.load();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("MealyDocStore.apply", () => {
  it("sends ops through the client and applies the returned patch diff", async () => {
    const client = fakeClient({ mealySnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new MealyDocStore(client);
    await store.load();

    client.mealyApply.mockResolvedValue({
      revision: 1,
      patches: [{ patch: "StateAdded", id: 5, label: "q0", x: 1, y: 2 }],
      derived: { input_alphabet: [], output_alphabet: [], deterministic: true, unreachable: [] },
    });

    const ops = [{ op: "AddState", label: "q0", x: 1, y: 2 }];
    await store.apply(ops);

    expect(client.mealyApply).toHaveBeenCalledWith(ops);
    expect(store.revision).toBe(1);
    expect(store.getStates()).toEqual([{ id: 5, label: "q0", x: 1, y: 2, initial: false }]);
  });

  it("applies every MealyDocPatch variant to the local mirror", async () => {
    const client = fakeClient({ mealySnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new MealyDocStore(client);
    await store.load();

    client.mealyApply.mockResolvedValue({
      revision: 1,
      patches: [
        { patch: "StateAdded", id: 1, label: "q0", x: 0, y: 0 },
        { patch: "StateAdded", id: 2, label: "q1", x: 5, y: 5 },
        { patch: "StateInitialSet", id: 1, initial: true },
        { patch: "EdgeTransitionsSet", from: 1, to: 2, entries: [["a", "x"], ["b", "y"]] },
        { patch: "AlphabetSet", input: ["a", "b"], output: ["x", "y"] },
      ],
      derived: { input_alphabet: ["a", "b"], output_alphabet: ["x", "y"], deterministic: true, unreachable: [] },
    });
    await store.apply([]);

    expect(store.getStates()).toEqual([
      { id: 1, label: "q0", x: 0, y: 0, initial: true },
      { id: 2, label: "q1", x: 5, y: 5, initial: false },
    ]);
    expect(store.getEdges()).toEqual([{ from: 1, to: 2, transitions: [["a", "x"], ["b", "y"]] }]);

    client.mealyApply.mockResolvedValue({
      revision: 2,
      patches: [
        { patch: "StateMoved", id: 2, x: 9, y: 9 },
        { patch: "StateRenamed", id: 2, label: "q1renamed" },
      ],
      derived: store.derived,
    });
    await store.apply([]);
    expect(store.getState(2)).toEqual({ id: 2, label: "q1renamed", x: 9, y: 9, initial: false });

    client.mealyApply.mockResolvedValue({
      revision: 3,
      patches: [{ patch: "EdgeRemoved", from: 1, to: 2 }, { patch: "StateRemoved", id: 1 }],
      derived: store.derived,
    });
    await store.apply([]);
    expect(store.getEdges()).toEqual([]);
    expect(store.getState(1)).toBeUndefined();
  });

  it("triggers a full resync when the returned revision is not the expected next one", async () => {
    const client = fakeClient({ mealySnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new MealyDocStore(client);
    await store.load();

    const resyncSnapshot = {
      revision: 42,
      states: [{ id: 9, label: "q9", x: 0, y: 0, initial: true }],
      edges: [],
      derived: { input_alphabet: [], output_alphabet: [], deterministic: true, unreachable: [] },
    };
    client.mealySnapshot.mockResolvedValue(resyncSnapshot);
    client.mealyApply.mockResolvedValue({
      revision: 7,
      patches: [{ patch: "StateAdded", id: 1, label: "should-be-ignored", x: 0, y: 0 }],
      derived: emptySnapshot.derived,
    });

    await store.apply([{ op: "AddState", label: "x", x: 0, y: 0 }]);

    expect(client.mealySnapshot).toHaveBeenCalledTimes(2);
    expect(store.revision).toBe(42);
    expect(store.getStates()).toEqual(resyncSnapshot.states);
  });
});

describe("MealyDocStore.undo / redo", () => {
  it("applies the patch diff when the server returns a result", async () => {
    const client = fakeClient({ mealySnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new MealyDocStore(client);
    await store.load();

    client.mealyUndo.mockResolvedValue({
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
    const client = fakeClient({ mealySnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new MealyDocStore(client);
    await store.load();
    const listener = vi.fn();
    store.subscribe(listener);

    client.mealyUndo.mockResolvedValue(null);
    expect(await store.undo()).toBeNull();
    expect(listener).not.toHaveBeenCalled();

    client.mealyRedo.mockResolvedValue(null);
    expect(await store.redo()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("MealyDocStore.subscribe", () => {
  it("returns an unsubscribe function", async () => {
    const client = fakeClient({ mealySnapshot: vi.fn().mockResolvedValue(emptySnapshot) });
    const store = new MealyDocStore(client);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    await store.load();

    expect(listener).not.toHaveBeenCalled();
  });
});
