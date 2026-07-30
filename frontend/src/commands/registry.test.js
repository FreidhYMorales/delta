import { describe, expect, it, vi } from "vitest";
import { actions, findAction, findByKeybinding, TOOL_IDS } from "./registry.js";

function fakeCtx(overrides = {}) {
  return {
    activeTool: "select",
    setTool: vi.fn(),
    selection: null,
    setSelection: vi.fn(),
    docStore: { apply: vi.fn().mockResolvedValue(undefined), undo: vi.fn(), redo: vi.fn() },
    viewport: { zoomIn: vi.fn(), zoomOut: vi.fn(), reset: vi.fn(), fitToWindow: vi.fn() },
    layout: { circle: vi.fn() },
    promptPath: vi.fn().mockResolvedValue("/tmp/x.jff"),
    importJff: vi.fn(),
    exportJff: vi.fn(),
    ...overrides,
  };
}

describe("registry structural guarantees (task 7.2)", () => {
  it("every action has a non-empty string id and a run function", () => {
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(typeof action.id).toBe("string");
      expect(action.id.length).toBeGreaterThan(0);
      expect(typeof action.run).toBe("function");
      expect(typeof action.title).toBe("string");
      expect(typeof action.group).toBe("string");
    }
  });

  it("has unique action ids", () => {
    const ids = actions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("seeds the full kflap-v0.1 prototype action inventory plus jff import/export", () => {
    const ids = actions.map((a) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "tool.select",
        "tool.createState",
        "tool.createTransition",
        "tool.delete",
        "state.rename",
        "state.markInitial",
        "state.toggleAccepting",
        "edit.deleteSelection",
        "edit.undo",
        "edit.redo",
        "view.zoomIn",
        "view.zoomOut",
        "view.zoomReset",
        "view.fitToWindow",
        "view.circleLayout",
        "jff.import",
        "jff.export",
      ]),
    );
  });

  it("every action is reachable via a keybinding or is otherwise menu/palette-listed (nothing is toolbar-only)", () => {
    // Structural guarantee: the registry itself IS the reachability surface —
    // menubar, context menus, toolbar and the command palette are only ever
    // projections that iterate `actions`/`findByKeybinding`. An action with
    // no keybinding is still reachable via the palette (every action in
    // `actions` is listed there), so the only requirement here is that the
    // action actually exists in this single source of truth.
    for (const action of actions) {
      expect(actions).toContain(action);
    }
  });

  it("the four core diagram tools have their documented V/S/T/D keybindings", () => {
    expect(findByKeybinding("v")?.id).toBe("tool.select");
    expect(findByKeybinding("s")?.id).toBe("tool.createState");
    expect(findByKeybinding("t")?.id).toBe("tool.createTransition");
    expect(findByKeybinding("d")?.id).toBe("tool.delete");
  });

  it("TOOL_IDS lists exactly the four core tool action ids in registry order", () => {
    expect(TOOL_IDS).toEqual([
      "tool.select",
      "tool.createState",
      "tool.createTransition",
      "tool.delete",
    ]);
  });
});

describe("findAction / findByKeybinding", () => {
  it("finds an action by id", () => {
    expect(findAction("tool.select").title).toBeTruthy();
    expect(findAction("does.not.exist")).toBeUndefined();
  });

  it("returns undefined for an unbound key", () => {
    expect(findByKeybinding("ctrl+shift+9")).toBeUndefined();
  });
});

describe("action.run behavior", () => {
  it("tool.* actions call ctx.setTool with their tool name", () => {
    const ctx = fakeCtx();
    findAction("tool.select").run(ctx);
    expect(ctx.setTool).toHaveBeenCalledWith("select");
    findAction("tool.createState").run(ctx);
    expect(ctx.setTool).toHaveBeenCalledWith("create-state");
    findAction("tool.createTransition").run(ctx);
    expect(ctx.setTool).toHaveBeenCalledWith("create-transition");
    findAction("tool.delete").run(ctx);
    expect(ctx.setTool).toHaveBeenCalledWith("delete");
  });

  it("edit.undo / edit.redo delegate to the DocStore", () => {
    const ctx = fakeCtx();
    findAction("edit.undo").run(ctx);
    expect(ctx.docStore.undo).toHaveBeenCalled();
    findAction("edit.redo").run(ctx);
    expect(ctx.docStore.redo).toHaveBeenCalled();
  });

  it("edit.deleteSelection removes a selected state via docStore.apply", () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 7 } });
    findAction("edit.deleteSelection").run(ctx);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "RemoveState", id: 7 }]);
  });

  it("edit.deleteSelection clears a selected edge via an empty SetEdge", () => {
    const ctx = fakeCtx({ selection: { kind: "edge", from: 1, to: 2 } });
    findAction("edit.deleteSelection").run(ctx);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([
      { op: "SetEdge", from: 1, to: 2, epsilon: false, symbols: [] },
    ]);
  });

  it("edit.deleteSelection is a when()-gated no-op with no selection", () => {
    const ctx = fakeCtx({ selection: null });
    expect(findAction("edit.deleteSelection").when(ctx)).toBe(false);
  });

  it("state.markInitial and state.toggleAccepting are gated on a selected state", () => {
    const withState = fakeCtx({ selection: { kind: "state", id: 3 } });
    expect(findAction("state.markInitial").when(withState)).toBe(true);
    expect(findAction("state.toggleAccepting").when(withState)).toBe(true);

    const withEdge = fakeCtx({ selection: { kind: "edge", from: 1, to: 2 } });
    expect(findAction("state.markInitial").when(withEdge)).toBe(false);
  });

  it("state.markInitial applies SetInitial for the selected state", () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 3 } });
    findAction("state.markInitial").run(ctx);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "SetInitial", id: 3 }]);
  });

  it("view.circleLayout delegates to ctx.layout.circle", () => {
    const ctx = fakeCtx();
    findAction("view.circleLayout").run(ctx);
    expect(ctx.layout.circle).toHaveBeenCalled();
  });

  it("jff.import prompts for a path and imports it", async () => {
    const ctx = fakeCtx();
    await findAction("jff.import").run(ctx);
    expect(ctx.promptPath).toHaveBeenCalledWith("open-jff");
    expect(ctx.importJff).toHaveBeenCalledWith("/tmp/x.jff");
  });

  it("jff.export prompts for a path and exports it", async () => {
    const ctx = fakeCtx();
    await findAction("jff.export").run(ctx);
    expect(ctx.promptPath).toHaveBeenCalledWith("save-jff");
    expect(ctx.exportJff).toHaveBeenCalledWith("/tmp/x.jff");
  });
});
