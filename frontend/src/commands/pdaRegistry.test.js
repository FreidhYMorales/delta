import { describe, expect, it, vi } from "vitest";
import {
  findPdaAction,
  findPdaActionByKeybinding,
  keybindingOf,
  PDA_MENU_GROUP_TITLES,
  PDA_TOOL_IDS,
  pdaActions,
  promptTransitionTriple,
} from "./pdaRegistry.js";
import { keybindingOf as fromRegistry } from "./registry.js";

function fakeCtx(overrides = {}) {
  return {
    activeTool: "select",
    selection: null,
    setTool: vi.fn(),
    docStore: {
      apply: vi.fn().mockResolvedValue({ revision: 1, patches: [], derived: {} }),
      undo: vi.fn(),
      redo: vi.fn(),
      getState: vi.fn(),
      getTransition: vi.fn(),
    },
    promptLabel: vi.fn().mockResolvedValue(null),
    promptInput: vi.fn().mockResolvedValue(null),
    promptPop: vi.fn().mockResolvedValue(null),
    promptPush: vi.fn().mockResolvedValue(null),
    renameState: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("pdaRegistry structural guarantees", () => {
  it("every action has a unique id", () => {
    const ids = pdaActions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every action has a title, group, when, and run", () => {
    for (const action of pdaActions) {
      expect(typeof action.title).toBe("string");
      expect(typeof action.group).toBe("string");
      expect(typeof action.when).toBe("function");
      expect(typeof action.run).toBe("function");
    }
  });

  it("PDA_TOOL_IDS lists exactly the 4 tool actions, in order", () => {
    expect(PDA_TOOL_IDS).toEqual(["tool.select", "tool.createState", "tool.createTransition", "tool.delete"]);
  });

  it("re-exports the same keybindingOf as commands/registry.js", () => {
    expect(keybindingOf).toBe(fromRegistry);
  });
});

describe("findPdaAction / findPdaActionByKeybinding", () => {
  it("finds an action by id", () => {
    expect(findPdaAction("tool.select")?.id).toBe("tool.select");
  });

  it("returns undefined for an unknown id", () => {
    expect(findPdaAction("nope")).toBeUndefined();
  });

  it("finds an action by keybinding", () => {
    expect(findPdaActionByKeybinding("s")?.id).toBe("tool.createState");
    expect(findPdaActionByKeybinding("ctrl+z")?.id).toBe("edit.undo");
  });

  it("returns undefined for an unbound key", () => {
    expect(findPdaActionByKeybinding("z")).toBeUndefined();
  });
});

describe("tool actions", () => {
  it("each tool.* action calls ctx.setTool with the matching tool id", () => {
    const ctx = fakeCtx();
    findPdaAction("tool.select").run(ctx);
    findPdaAction("tool.createState").run(ctx);
    findPdaAction("tool.createTransition").run(ctx);
    findPdaAction("tool.delete").run(ctx);
    expect(ctx.setTool.mock.calls.map((c) => c[0])).toEqual(["select", "create-state", "create-transition", "delete"]);
  });

  it("tool actions are always available (when() is true with no selection)", () => {
    const ctx = fakeCtx();
    for (const id of PDA_TOOL_IDS) {
      expect(findPdaAction(id).when(ctx)).toBe(true);
    }
  });
});

describe("state.rename", () => {
  it("is only available when a state is selected", () => {
    expect(findPdaAction("state.rename").when(fakeCtx())).toBe(false);
    expect(findPdaAction("state.rename").when(fakeCtx({ selection: { kind: "state", id: 1 } }))).toBe(true);
    expect(findPdaAction("state.rename").when(fakeCtx({ selection: { kind: "transition", id: 1 } }))).toBe(false);
  });

  it("prompts for a label and renames when one is given", async () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 3 }, promptLabel: vi.fn().mockResolvedValue("q1") });
    await findPdaAction("state.rename").run(ctx);
    expect(ctx.promptLabel).toHaveBeenCalledWith(3);
    expect(ctx.renameState).toHaveBeenCalledWith(3, "q1");
  });

  it("does nothing when the prompt is cancelled", async () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 3 } });
    await findPdaAction("state.rename").run(ctx);
    expect(ctx.renameState).not.toHaveBeenCalled();
  });
});

describe("state.markInitial", () => {
  it("is only available when a state is selected", () => {
    expect(findPdaAction("state.markInitial").when(fakeCtx())).toBe(false);
    expect(findPdaAction("state.markInitial").when(fakeCtx({ selection: { kind: "state", id: 2 } }))).toBe(true);
  });

  it("applies a SetInitial op for the selected state", () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 2 } });
    findPdaAction("state.markInitial").run(ctx);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "SetInitial", id: 2 }]);
  });
});

describe("state.toggleAccepting (no Mealy/Moore equivalent)", () => {
  it("is only available when a state is selected", () => {
    expect(findPdaAction("state.toggleAccepting").when(fakeCtx())).toBe(false);
    expect(findPdaAction("state.toggleAccepting").when(fakeCtx({ selection: { kind: "state", id: 4 } }))).toBe(true);
  });

  it("flips accepting from false to true with no prompt involved", async () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 4 } });
    ctx.docStore.getState.mockReturnValue({ id: 4, accepting: false });
    await findPdaAction("state.toggleAccepting").run(ctx);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "SetAccepting", id: 4, accepting: true }]);
  });

  it("flips accepting from true to false", async () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 4 } });
    ctx.docStore.getState.mockReturnValue({ id: 4, accepting: true });
    await findPdaAction("state.toggleAccepting").run(ctx);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "SetAccepting", id: 4, accepting: false }]);
  });
});

describe("transition.edit (no Mealy/Moore equivalent — PDA transitions are individually addressable)", () => {
  it("is only available when a transition is selected", () => {
    expect(findPdaAction("transition.edit").when(fakeCtx())).toBe(false);
    expect(findPdaAction("transition.edit").when(fakeCtx({ selection: { kind: "transition", id: 7 } }))).toBe(true);
  });

  it("prompts the three fields pre-filled with the existing transition and applies EditTransition", async () => {
    const promptInput = vi.fn().mockResolvedValue("b");
    const promptPop = vi.fn().mockResolvedValue("Z");
    const promptPush = vi.fn().mockResolvedValue("A Z");
    const ctx = fakeCtx({ selection: { kind: "transition", id: 7 }, promptInput, promptPop, promptPush });
    ctx.docStore.getTransition.mockReturnValue({ id: 7, from: 1, to: 2, input: "a", pop: ["Z"], push: [] });

    await findPdaAction("transition.edit").run(ctx);

    expect(promptInput).toHaveBeenCalledWith("a");
    expect(promptPop).toHaveBeenCalledWith("Z");
    expect(promptPush).toHaveBeenCalledWith("");
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "EditTransition", id: 7, input: "b", pop: ["Z"], push: ["A", "Z"] }]);
  });

  it("aborts with no op applied when any of the three prompts is cancelled", async () => {
    const ctx = fakeCtx({
      selection: { kind: "transition", id: 7 },
      promptInput: vi.fn().mockResolvedValue("b"),
      promptPop: vi.fn().mockResolvedValue(null),
    });
    ctx.docStore.getTransition.mockReturnValue({ id: 7, from: 1, to: 2, input: "a", pop: [], push: [] });

    await findPdaAction("transition.edit").run(ctx);

    expect(ctx.docStore.apply).not.toHaveBeenCalled();
  });
});

describe("promptTransitionTriple", () => {
  it("returns null and stops immediately when the input prompt is cancelled", async () => {
    const ctx = fakeCtx({ promptInput: vi.fn().mockResolvedValue(null) });
    expect(await promptTransitionTriple(ctx)).toBeNull();
    expect(ctx.promptPop).not.toHaveBeenCalled();
    expect(ctx.promptPush).not.toHaveBeenCalled();
  });

  it("returns null when the pop prompt is cancelled, after the input prompt already ran", async () => {
    const ctx = fakeCtx({ promptInput: vi.fn().mockResolvedValue("a"), promptPop: vi.fn().mockResolvedValue(null) });
    expect(await promptTransitionTriple(ctx)).toBeNull();
    expect(ctx.promptPush).not.toHaveBeenCalled();
  });

  it("returns the parsed triple, treating blank fields as epsilon", async () => {
    const ctx = fakeCtx({
      promptInput: vi.fn().mockResolvedValue(""),
      promptPop: vi.fn().mockResolvedValue(""),
      promptPush: vi.fn().mockResolvedValue("A Z"),
    });
    expect(await promptTransitionTriple(ctx)).toEqual({ input: null, pop: [], push: ["A", "Z"] });
  });
});

describe("edit.deleteSelection", () => {
  it("is only available when something is selected", () => {
    expect(findPdaAction("edit.deleteSelection").when(fakeCtx())).toBe(false);
    expect(findPdaAction("edit.deleteSelection").when(fakeCtx({ selection: { kind: "state", id: 1 } }))).toBe(true);
  });

  it("removes a selected state via RemoveState", () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 5 } });
    findPdaAction("edit.deleteSelection").run(ctx);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "RemoveState", id: 5 }]);
  });

  it("removes a selected transition via RemoveTransition, by its own id (not from/to — several can share endpoints)", () => {
    const ctx = fakeCtx({ selection: { kind: "transition", id: 9 } });
    findPdaAction("edit.deleteSelection").run(ctx);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "RemoveTransition", id: 9 }]);
  });
});

describe("edit.undo / edit.redo", () => {
  it("always available and delegate to docStore", () => {
    const ctx = fakeCtx();
    expect(findPdaAction("edit.undo").when(ctx)).toBe(true);
    expect(findPdaAction("edit.redo").when(ctx)).toBe(true);
    findPdaAction("edit.undo").run(ctx);
    findPdaAction("edit.redo").run(ctx);
    expect(ctx.docStore.undo).toHaveBeenCalled();
    expect(ctx.docStore.redo).toHaveBeenCalled();
  });
});

describe("PDA_MENU_GROUP_TITLES (PR11: main.js composes the shared MenuBar per active tab kind)", () => {
  it("maps only the edit group to a menu title — no view/testing/interop/convert group yet", () => {
    expect(PDA_MENU_GROUP_TITLES).toEqual({ edit: "Editar" });
  });
});
