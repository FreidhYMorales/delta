import { describe, expect, it, vi } from "vitest";
import {
  findMooreAction,
  findMooreActionByKeybinding,
  keybindingOf,
  MOORE_MENU_GROUP_TITLES,
  MOORE_TOOL_IDS,
  mooreActions,
} from "./mooreRegistry.js";
import { keybindingOf as fromRegistry } from "./registry.js";

function fakeCtx(overrides = {}) {
  return {
    activeTool: "select",
    selection: null,
    setTool: vi.fn(),
    docStore: { apply: vi.fn().mockResolvedValue({ revision: 1, patches: [], derived: {} }), undo: vi.fn(), redo: vi.fn() },
    promptLabel: vi.fn().mockResolvedValue(null),
    promptOutput: vi.fn().mockResolvedValue(null),
    renameState: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("mooreRegistry structural guarantees", () => {
  it("every action has a unique id", () => {
    const ids = mooreActions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every action has a title, group, when, and run", () => {
    for (const action of mooreActions) {
      expect(typeof action.title).toBe("string");
      expect(typeof action.group).toBe("string");
      expect(typeof action.when).toBe("function");
      expect(typeof action.run).toBe("function");
    }
  });

  it("MOORE_TOOL_IDS lists exactly the 4 tool actions, in order", () => {
    expect(MOORE_TOOL_IDS).toEqual(["tool.select", "tool.createState", "tool.createTransition", "tool.delete"]);
  });

  it("re-exports the same keybindingOf as commands/registry.js", () => {
    expect(keybindingOf).toBe(fromRegistry);
  });
});

describe("findMooreAction / findMooreActionByKeybinding", () => {
  it("finds an action by id", () => {
    expect(findMooreAction("tool.select")?.id).toBe("tool.select");
  });

  it("returns undefined for an unknown id", () => {
    expect(findMooreAction("nope")).toBeUndefined();
  });

  it("finds an action by keybinding", () => {
    expect(findMooreActionByKeybinding("s")?.id).toBe("tool.createState");
    expect(findMooreActionByKeybinding("ctrl+z")?.id).toBe("edit.undo");
  });

  it("returns undefined for an unbound key", () => {
    expect(findMooreActionByKeybinding("z")).toBeUndefined();
  });
});

describe("tool actions", () => {
  it("each tool.* action calls ctx.setTool with the matching tool id", () => {
    const ctx = fakeCtx();
    findMooreAction("tool.select").run(ctx);
    findMooreAction("tool.createState").run(ctx);
    findMooreAction("tool.createTransition").run(ctx);
    findMooreAction("tool.delete").run(ctx);
    expect(ctx.setTool.mock.calls.map((c) => c[0])).toEqual(["select", "create-state", "create-transition", "delete"]);
  });

  it("tool actions are always available (when() is true with no selection)", () => {
    const ctx = fakeCtx();
    for (const id of MOORE_TOOL_IDS) {
      expect(findMooreAction(id).when(ctx)).toBe(true);
    }
  });
});

describe("state.rename", () => {
  it("is only available when a state is selected", () => {
    expect(findMooreAction("state.rename").when(fakeCtx())).toBe(false);
    expect(findMooreAction("state.rename").when(fakeCtx({ selection: { kind: "state", id: 1 } }))).toBe(true);
    expect(findMooreAction("state.rename").when(fakeCtx({ selection: { kind: "edge", from: 1, to: 2 } }))).toBe(false);
  });

  it("prompts for a label and renames when one is given", async () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 3 }, promptLabel: vi.fn().mockResolvedValue("q1") });
    await findMooreAction("state.rename").run(ctx);
    expect(ctx.promptLabel).toHaveBeenCalledWith(3);
    expect(ctx.renameState).toHaveBeenCalledWith(3, "q1");
  });

  it("does nothing when the prompt is cancelled", async () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 3 } });
    await findMooreAction("state.rename").run(ctx);
    expect(ctx.renameState).not.toHaveBeenCalled();
  });
});

describe("state.markInitial", () => {
  it("is only available when a state is selected", () => {
    expect(findMooreAction("state.markInitial").when(fakeCtx())).toBe(false);
    expect(findMooreAction("state.markInitial").when(fakeCtx({ selection: { kind: "state", id: 2 } }))).toBe(true);
  });

  it("applies a SetInitial op for the selected state", () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 2 } });
    findMooreAction("state.markInitial").run(ctx);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "SetInitial", id: 2 }]);
  });
});

describe("state.setOutput (no Mealy equivalent)", () => {
  it("is only available when a state is selected", () => {
    expect(findMooreAction("state.setOutput").when(fakeCtx())).toBe(false);
    expect(findMooreAction("state.setOutput").when(fakeCtx({ selection: { kind: "state", id: 4 } }))).toBe(true);
  });

  it("prompts for an output and applies SetOutput with the selected state id", async () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 4 }, promptOutput: vi.fn().mockResolvedValue("even") });
    await findMooreAction("state.setOutput").run(ctx);
    expect(ctx.promptOutput).toHaveBeenCalledWith(4);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "SetOutput", state: 4, output: "even" }]);
  });

  it("does nothing when the prompt is cancelled (returns null)", async () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 4 } });
    await findMooreAction("state.setOutput").run(ctx);
    expect(ctx.docStore.apply).not.toHaveBeenCalled();
  });

  it("allows setting an explicit empty output (not the same as cancelling)", async () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 4 }, promptOutput: vi.fn().mockResolvedValue("") });
    await findMooreAction("state.setOutput").run(ctx);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "SetOutput", state: 4, output: "" }]);
  });
});

describe("edit.deleteSelection", () => {
  it("is only available when something is selected", () => {
    expect(findMooreAction("edit.deleteSelection").when(fakeCtx())).toBe(false);
    expect(findMooreAction("edit.deleteSelection").when(fakeCtx({ selection: { kind: "state", id: 1 } }))).toBe(true);
  });

  it("removes a selected state via RemoveState", () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 5 } });
    findMooreAction("edit.deleteSelection").run(ctx);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "RemoveState", id: 5 }]);
  });

  it("clears a selected edge via SetTransitions with empty inputs (not 'entries', Moore has no per-symbol output)", () => {
    const ctx = fakeCtx({ selection: { kind: "edge", from: 1, to: 2 } });
    findMooreAction("edit.deleteSelection").run(ctx);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "SetTransitions", from: 1, to: 2, inputs: [] }]);
  });
});

describe("edit.undo / edit.redo", () => {
  it("always available and delegate to docStore", () => {
    const ctx = fakeCtx();
    expect(findMooreAction("edit.undo").when(ctx)).toBe(true);
    expect(findMooreAction("edit.redo").when(ctx)).toBe(true);
    findMooreAction("edit.undo").run(ctx);
    findMooreAction("edit.redo").run(ctx);
    expect(ctx.docStore.undo).toHaveBeenCalled();
    expect(ctx.docStore.redo).toHaveBeenCalled();
  });
});

describe("MOORE_MENU_GROUP_TITLES (PR11: main.js composes the shared MenuBar per active tab kind)", () => {
  it("maps only the edit group to a menu title — no view/testing/interop/convert group yet", () => {
    expect(MOORE_MENU_GROUP_TITLES).toEqual({ edit: "Editar" });
  });
});
