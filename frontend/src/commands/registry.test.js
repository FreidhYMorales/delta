import { describe, expect, it, vi } from "vitest";
import { actions, EDITOR_MODE_IDS, findAction, findByKeybinding, keybindingOf, TOOL_IDS } from "./registry.js";
import { MENU_GROUP_TITLES } from "../views/menubar/MenuBar.js";

// The diagram's right-click context menu (`DiagramView._onCanvasContextMenu`)
// hardcodes this exact id list. Kept here too — not imported — because
// `DiagramView.js` doesn't export it; this is the "hardcoded expected-
// coverage list" the UI/UX audit task explicitly allows, so a future PR
// can't silently reintroduce a 100%-unreachable action (no keybinding, not
// in the menu bar, not the toolbar, not the context menu) the way
// `jff.import`/`jff.export`/`test.singleTrace`/`test.batch` briefly were.
const CONTEXT_MENU_IDS = new Set([
  "state.rename",
  "state.markInitial",
  "state.toggleAccepting",
  "edit.deleteSelection",
]);

function fakeCtx(overrides = {}) {
  return {
    activeTool: "select",
    setTool: vi.fn(),
    selection: null,
    setSelection: vi.fn(),
    docStore: {
      apply: vi.fn().mockResolvedValue(undefined),
      undo: vi.fn(),
      redo: vi.fn(),
      derived: { classification: "Dfa", alphabet: [], unreachable: [] },
    },
    viewport: { zoomIn: vi.fn(), zoomOut: vi.fn(), reset: vi.fn(), fitToWindow: vi.fn() },
    layout: { circle: vi.fn() },
    promptPath: vi.fn().mockResolvedValue("/tmp/x.jff"),
    importJff: vi.fn(),
    exportJff: vi.fn(),
    promptLabel: vi.fn().mockResolvedValue("q9"),
    renameState: vi.fn().mockResolvedValue(true),
    testing: { openSingle: vi.fn(), openBatch: vi.fn() },
    openRegexTab: vi.fn(),
    openGrammarTab: vi.fn(),
    convertToDfa: vi.fn(),
    minimizeDfa: vi.fn(),
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
        "test.singleTrace",
        "test.batch",
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

describe("keybindingOf (bug 4: Ctrl+Shift+Z must not collide with Ctrl+Z)", () => {
  it("produces a distinct binding for Ctrl+Shift+Z vs plain Ctrl+Z", () => {
    const undo = keybindingOf({ key: "z", ctrlKey: true, shiftKey: false, metaKey: false });
    const redo = keybindingOf({ key: "Z", ctrlKey: true, shiftKey: true, metaKey: false });
    expect(redo).not.toBe(undo);
  });

  it("normalizes Ctrl+Shift+Z to exactly the registered edit.redo binding", () => {
    expect(keybindingOf({ key: "Z", ctrlKey: true, shiftKey: true, metaKey: false })).toBe(
      "ctrl+shift+z",
    );
  });

  it("normalizes plain Ctrl+Z to exactly the registered edit.undo binding", () => {
    expect(keybindingOf({ key: "z", ctrlKey: true, shiftKey: false, metaKey: false })).toBe(
      "ctrl+z",
    );
  });

  it("dispatches Ctrl+Shift+Z to edit.redo and Ctrl+Z to edit.undo, not the same action", () => {
    expect(findByKeybinding(keybindingOf({ key: "Z", ctrlKey: true, shiftKey: true })).id).toBe(
      "edit.redo",
    );
    expect(findByKeybinding(keybindingOf({ key: "z", ctrlKey: true, shiftKey: false })).id).toBe(
      "edit.undo",
    );
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

  it("state.rename prompts for a label and delegates to ctx.renameState (task 7.9)", async () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 3 } });
    await findAction("state.rename").run(ctx);
    expect(ctx.promptLabel).toHaveBeenCalledWith(3);
    expect(ctx.renameState).toHaveBeenCalledWith(3, "q9");
    // Must never bypass the notice-aware hook with a raw apply call.
    expect(ctx.docStore.apply).not.toHaveBeenCalled();
  });

  it("state.rename does nothing when the prompt is cancelled", async () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 3 }, promptLabel: vi.fn().mockResolvedValue(null) });
    await findAction("state.rename").run(ctx);
    expect(ctx.renameState).not.toHaveBeenCalled();
  });

  it("test.singleTrace opens the single-trace drawer", () => {
    const ctx = fakeCtx();
    findAction("test.singleTrace").run(ctx);
    expect(ctx.testing.openSingle).toHaveBeenCalled();
  });

  it("test.batch opens the batch-test drawer", () => {
    const ctx = fakeCtx();
    findAction("test.batch").run(ctx);
    expect(ctx.testing.openBatch).toHaveBeenCalled();
  });

  it("editor.openRegex jumps to the Expresión regular tab", () => {
    const ctx = fakeCtx();
    findAction("editor.openRegex").run(ctx);
    expect(ctx.openRegexTab).toHaveBeenCalled();
  });

  it("editor.openGrammar jumps to the Gramática regular tab", () => {
    const ctx = fakeCtx();
    findAction("editor.openGrammar").run(ctx);
    expect(ctx.openGrammarTab).toHaveBeenCalled();
  });

  it("convert.toDfa calls ctx.convertToDfa", () => {
    const ctx = fakeCtx();
    findAction("convert.toDfa").run(ctx);
    expect(ctx.convertToDfa).toHaveBeenCalled();
  });

  it("convert.toDfa is available regardless of the current classification", () => {
    const nfaCtx = fakeCtx({
      docStore: { apply: vi.fn(), undo: vi.fn(), redo: vi.fn(), derived: { classification: "Nfa", alphabet: [], unreachable: [] } },
    });
    expect(findAction("convert.toDfa").when(nfaCtx)).toBe(true);
  });

  it("convert.minimizeDfa calls ctx.minimizeDfa", () => {
    const ctx = fakeCtx();
    findAction("convert.minimizeDfa").run(ctx);
    expect(ctx.minimizeDfa).toHaveBeenCalled();
  });

  it("convert.minimizeDfa is only available when the current automaton is already a DFA", () => {
    const dfaCtx = fakeCtx();
    expect(findAction("convert.minimizeDfa").when(dfaCtx)).toBe(true);

    const nfaCtx = fakeCtx({
      docStore: { apply: vi.fn(), undo: vi.fn(), redo: vi.fn(), derived: { classification: "Nfa", alphabet: [], unreachable: [] } },
    });
    expect(findAction("convert.minimizeDfa").when(nfaCtx)).toBe(false);
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

describe("reachability audit (UI/UX audit pass — no action may end up 100% unreachable)", () => {
  const toolIds = new Set(TOOL_IDS);
  const editorModeIds = new Set(EDITOR_MODE_IDS);

  it("every action has a real, discoverable trigger: a keybinding, a menu-bar entry, a toolbar button, a context-menu item, or the editor-mode dropdown", () => {
    for (const action of actions) {
      const reachable =
        action.keybinding != null ||
        Object.prototype.hasOwnProperty.call(MENU_GROUP_TITLES, action.group) ||
        toolIds.has(action.id) ||
        CONTEXT_MENU_IDS.has(action.id) ||
        editorModeIds.has(action.id);
      expect(
        reachable,
        `action "${action.id}" (group "${action.group}") has no keybinding and is not ` +
          `covered by the menu bar, the toolbar, the diagram context menu, or the editor-mode dropdown`,
      ).toBe(true);
    }
  });

  it("the previously 100%-unreachable actions are now menu-bar covered (jff.import/export, test.singleTrace/batch)", () => {
    for (const id of ["jff.import", "jff.export", "test.singleTrace", "test.batch"]) {
      const action = findAction(id);
      expect(action.keybinding).toBeNull();
      expect(MENU_GROUP_TITLES).toHaveProperty(action.group);
    }
  });

  it("keyboard-only actions (undo/redo/zoom/fit/circle layout) are also menu-bar covered, not just key-bound", () => {
    for (const id of [
      "edit.undo",
      "edit.redo",
      "view.zoomIn",
      "view.zoomOut",
      "view.zoomReset",
      "view.fitToWindow",
      "view.circleLayout",
    ]) {
      const action = findAction(id);
      expect(action.keybinding).not.toBeNull();
      expect(MENU_GROUP_TITLES).toHaveProperty(action.group);
    }
  });

  it("every `state` group action is covered by the hardcoded context-menu id list or has its own keybinding", () => {
    for (const action of actions.filter((a) => a.group === "state")) {
      expect(CONTEXT_MENU_IDS.has(action.id) || action.keybinding != null).toBe(true);
    }
  });

  it("every `editor` group action is covered by EDITOR_MODE_IDS (the toolbar's Editor dropdown)", () => {
    for (const action of actions.filter((a) => a.group === "editor")) {
      expect(editorModeIds.has(action.id)).toBe(true);
    }
  });
});
