import { describe, expect, it, vi } from "vitest";
import { bindFaTab, bindMealyTab, bindMooreTab, bindPdaTab, bindTmTab } from "./tabClient.js";
import { DocStore } from "../store/DocStore.js";

function fakeClient(overrides = {}) {
  return {
    docSnapshot: vi.fn(),
    docApply: vi.fn(),
    docUndo: vi.fn(),
    docRedo: vi.fn(),
    docOpen: vi.fn(),
    docSave: vi.fn(),
    simTrace: vi.fn(),
    simBatch: vi.fn(),
    jffImport: vi.fn(),
    jffExport: vi.fn(),
    convToRegex: vi.fn(),
    convFromRegex: vi.fn(),
    convToGrammar: vi.fn(),
    convFromGrammar: vi.fn(),
    convNfaToDfa: vi.fn(),
    convMinimizeDfa: vi.fn(),
    mealySnapshot: vi.fn(),
    mealyApply: vi.fn(),
    mealyUndo: vi.fn(),
    mealyRedo: vi.fn(),
    mealyOpen: vi.fn(),
    mealySave: vi.fn(),
    mealySim: vi.fn(),
    mooreSnapshot: vi.fn(),
    mooreApply: vi.fn(),
    mooreUndo: vi.fn(),
    mooreRedo: vi.fn(),
    mooreOpen: vi.fn(),
    mooreSave: vi.fn(),
    mooreSim: vi.fn(),
    pdaSnapshot: vi.fn(),
    pdaApply: vi.fn(),
    pdaUndo: vi.fn(),
    pdaRedo: vi.fn(),
    pdaOpen: vi.fn(),
    pdaSave: vi.fn(),
    pdaSim: vi.fn(),
    tmSnapshot: vi.fn(),
    tmApply: vi.fn(),
    tmUndo: vi.fn(),
    tmRedo: vi.fn(),
    tmOpen: vi.fn(),
    tmSave: vi.fn(),
    tmSim: vi.fn(),
    ...overrides,
  };
}

describe("bindFaTab (design D6)", () => {
  it("forwards every FA method to the underlying client with tabId appended", () => {
    const client = fakeClient();
    const bound = bindFaTab(client, 7);

    bound.docSnapshot();
    expect(client.docSnapshot).toHaveBeenCalledWith(7);

    bound.docApply([{ op: "AddState" }]);
    expect(client.docApply).toHaveBeenCalledWith([{ op: "AddState" }], 7);

    bound.docUndo();
    expect(client.docUndo).toHaveBeenCalledWith(7);

    bound.docRedo();
    expect(client.docRedo).toHaveBeenCalledWith(7);

    bound.docOpen("/a.jff");
    expect(client.docOpen).toHaveBeenCalledWith("/a.jff", 7);

    bound.docSave("/a.jff");
    expect(client.docSave).toHaveBeenCalledWith("/a.jff", 7);

    bound.simTrace(["a"], { max_steps: 1 });
    expect(client.simTrace).toHaveBeenCalledWith(["a"], { max_steps: 1 }, 7);

    bound.simBatch([["a"]], undefined);
    expect(client.simBatch).toHaveBeenCalledWith([["a"]], undefined, 7);

    bound.jffImport("/a.jff");
    expect(client.jffImport).toHaveBeenCalledWith("/a.jff", 7);

    bound.jffExport("/a.jff");
    expect(client.jffExport).toHaveBeenCalledWith("/a.jff", 7);

    bound.convToRegex();
    expect(client.convToRegex).toHaveBeenCalledWith(7);

    bound.convFromRegex("a*b");
    expect(client.convFromRegex).toHaveBeenCalledWith("a*b", 7);

    bound.convToGrammar();
    expect(client.convToGrammar).toHaveBeenCalledWith(7);

    bound.convFromGrammar("S -> a S");
    expect(client.convFromGrammar).toHaveBeenCalledWith("S -> a S", 7);

    bound.convNfaToDfa();
    expect(client.convNfaToDfa).toHaveBeenCalledWith(7);

    bound.convMinimizeDfa();
    expect(client.convMinimizeDfa).toHaveBeenCalledWith(7);
  });

  it("produces a client shape duck-type-compatible with what DocStore expects", async () => {
    const snapshot = {
      revision: 1,
      states: [{ id: 1, label: "q0", x: 0, y: 0, initial: true, accepting: false }],
      edges: [],
      derived: { classification: "Dfa", alphabet: [], unreachable: [] },
    };
    const client = fakeClient({ docSnapshot: vi.fn().mockResolvedValue(snapshot) });
    const bound = bindFaTab(client, 42);

    const store = new DocStore(bound);
    await store.load();

    expect(client.docSnapshot).toHaveBeenCalledWith(42);
    expect(store.revision).toBe(1);
    expect(store.getStates()).toEqual(snapshot.states);
  });
});

describe("bindPdaTab (design D6)", () => {
  it("forwards every PDA method with tabId appended, including sim's extra args", () => {
    const client = fakeClient();
    const bound = bindPdaTab(client, 3);

    bound.pdaSnapshot();
    expect(client.pdaSnapshot).toHaveBeenCalledWith(3);

    bound.pdaApply([{ op: "AddState" }]);
    expect(client.pdaApply).toHaveBeenCalledWith([{ op: "AddState" }], 3);

    bound.pdaUndo();
    expect(client.pdaUndo).toHaveBeenCalledWith(3);

    bound.pdaRedo();
    expect(client.pdaRedo).toHaveBeenCalledWith(3);

    bound.pdaOpen("/p.jff");
    expect(client.pdaOpen).toHaveBeenCalledWith("/p.jff", 3);

    bound.pdaSave("/p.jff");
    expect(client.pdaSave).toHaveBeenCalledWith("/p.jff", 3);

    bound.pdaSim(["a"], "empty", { max_steps: 10 });
    expect(client.pdaSim).toHaveBeenCalledWith(["a"], "empty", { max_steps: 10 }, 3);
  });
});

describe("bindTmTab (design D6)", () => {
  it("forwards every TM method with tabId appended, including sim's extra args", () => {
    const client = fakeClient();
    const bound = bindTmTab(client, 9);

    bound.tmSnapshot();
    expect(client.tmSnapshot).toHaveBeenCalledWith(9);

    bound.tmApply([{ op: "AddState" }]);
    expect(client.tmApply).toHaveBeenCalledWith([{ op: "AddState" }], 9);

    bound.tmSim([["a"]], "halting", { max_steps: 5 });
    expect(client.tmSim).toHaveBeenCalledWith([["a"]], "halting", { max_steps: 5 }, 9);
  });
});

describe("bindMealyTab / bindMooreTab (design D6)", () => {
  it("bindMealyTab forwards every Mealy method with tabId appended", () => {
    const client = fakeClient();
    const bound = bindMealyTab(client, 1);

    bound.mealySnapshot();
    expect(client.mealySnapshot).toHaveBeenCalledWith(1);

    bound.mealyApply([{ op: "AddState" }]);
    expect(client.mealyApply).toHaveBeenCalledWith([{ op: "AddState" }], 1);

    bound.mealySim(["a"]);
    expect(client.mealySim).toHaveBeenCalledWith(["a"], 1);
  });

  it("bindMooreTab forwards every Moore method with tabId appended", () => {
    const client = fakeClient();
    const bound = bindMooreTab(client, 2);

    bound.mooreSnapshot();
    expect(client.mooreSnapshot).toHaveBeenCalledWith(2);

    bound.mooreSim(["a"]);
    expect(client.mooreSim).toHaveBeenCalledWith(["a"], 2);
  });
});
