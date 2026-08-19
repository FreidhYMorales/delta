import { describe, expect, it, vi } from "vitest";
import { findMealyAction, findMealyActionByKeybinding, keybindingOf, MEALY_TOOL_IDS, mealyActions } from "./mealyRegistry.js";

function fakeCtx(overrides = {}) {
  return {
    activeTool: "select",
    setTool: vi.fn(),
    selection: null,
    setSelection: vi.fn(),
    docStore: { apply: vi.fn().mockResolvedValue(undefined), undo: vi.fn(), redo: vi.fn() },
    promptLabel: vi.fn().mockResolvedValue("q9"),
    renameState: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("mealyRegistry structural guarantees", () => {
  it("every action has a non-empty string id and a run function", () => {
    expect(mealyActions.length).toBeGreaterThan(0);
    for (const action of mealyActions) {
      expect(typeof action.id).toBe("string");
      expect(action.id.length).toBeGreaterThan(0);
      expect(typeof action.run).toBe("function");
    }
  });

  it("has unique action ids", () => {
    const ids = mealyActions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("MEALY_TOOL_IDS lists exactly the four core tool action ids, in registry order", () => {
    expect(MEALY_TOOL_IDS).toEqual(["tool.select", "tool.createState", "tool.createTransition", "tool.delete"]);
  });

  it("the four core tools share the same V/S/T/D keybindings as the FA registry", () => {
    expect(findByKey("v").id).toBe("tool.select");
    expect(findByKey("s").id).toBe("tool.createState");
    expect(findByKey("t").id).toBe("tool.createTransition");
    expect(findByKey("d").id).toBe("tool.delete");
  });
});

function findByKey(key) {
  return findMealyActionByKeybinding(key);
}

describe("findMealyAction / findMealyActionByKeybinding", () => {
  it("finds an action by id", () => {
    expect(findMealyAction("tool.select").title).toBeTruthy();
    expect(findMealyAction("does.not.exist")).toBeUndefined();
  });

  it("returns undefined for an unbound key", () => {
    expect(findMealyActionByKeybinding("ctrl+shift+9")).toBeUndefined();
  });
});

describe("action.run behavior", () => {
  it("tool.* actions call ctx.setTool with their tool name", () => {
    const ctx = fakeCtx();
    findMealyAction("tool.createState").run(ctx);
    expect(ctx.setTool).toHaveBeenCalledWith("create-state");
  });

  it("state.rename prompts and renames via ctx.renameState", async () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 3 } });
    await findMealyAction("state.rename").run(ctx);
    expect(ctx.promptLabel).toHaveBeenCalledWith(3);
    expect(ctx.renameState).toHaveBeenCalledWith(3, "q9");
  });

  it("state.rename does nothing when the prompt is cancelled", async () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 3 }, promptLabel: vi.fn().mockResolvedValue(null) });
    await findMealyAction("state.rename").run(ctx);
    expect(ctx.renameState).not.toHaveBeenCalled();
  });

  it("state.markInitial applies SetInitial for the selected state", () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 2 } });
    findMealyAction("state.markInitial").run(ctx);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "SetInitial", id: 2 }]);
  });

  it("state.rename/markInitial are only available with a state selected", () => {
    const ctx = fakeCtx({ selection: { kind: "edge", from: 1, to: 2 } });
    expect(findMealyAction("state.rename").when(ctx)).toBe(false);
    expect(findMealyAction("state.markInitial").when(ctx)).toBe(false);
  });

  it("edit.deleteSelection removes a selected state", () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 4 } });
    findMealyAction("edit.deleteSelection").run(ctx);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "RemoveState", id: 4 }]);
  });

  it("edit.deleteSelection clears a selected edge's transitions", () => {
    const ctx = fakeCtx({ selection: { kind: "edge", from: 1, to: 2 } });
    findMealyAction("edit.deleteSelection").run(ctx);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "SetTransitions", from: 1, to: 2, entries: [] }]);
  });

  it("edit.deleteSelection is unavailable with nothing selected", () => {
    const ctx = fakeCtx();
    expect(findMealyAction("edit.deleteSelection").when(ctx)).toBe(false);
  });

  it("edit.undo/redo call docStore.undo/redo", () => {
    const ctx = fakeCtx();
    findMealyAction("edit.undo").run(ctx);
    findMealyAction("edit.redo").run(ctx);
    expect(ctx.docStore.undo).toHaveBeenCalled();
    expect(ctx.docStore.redo).toHaveBeenCalled();
  });
});

describe("keybindingOf (re-exported from the FA registry, nothing Mealy-specific about it)", () => {
  it("normalizes a plain key press", () => {
    expect(keybindingOf({ key: "v", ctrlKey: false, shiftKey: false, metaKey: false })).toBe("v");
  });
});
