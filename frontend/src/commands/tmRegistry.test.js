import { describe, expect, it, vi } from "vitest";
import {
  findTmAction,
  findTmActionByKeybinding,
  keybindingOf,
  TM_MENU_GROUP_TITLES,
  TM_TOOL_IDS,
  tmActions,
  promptTransitionTapes,
} from "./tmRegistry.js";
import { keybindingOf as fromRegistry } from "./registry.js";

function fakeCtx(overrides = {}) {
  return {
    activeTool: "select",
    selection: null,
    tapeCountChoice: 1,
    setTool: vi.fn(),
    docStore: {
      derived: { alphabet: [], tape_count: 0, deterministic: true, unreachable: [] },
      apply: vi.fn().mockResolvedValue({ revision: 1, patches: [], derived: {} }),
      undo: vi.fn(),
      redo: vi.fn(),
      getState: vi.fn(),
      getTransition: vi.fn(),
    },
    promptLabel: vi.fn().mockResolvedValue(null),
    promptTape: vi.fn().mockResolvedValue(null),
    renameState: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("tmRegistry structural guarantees", () => {
  it("every action has a unique id", () => {
    const ids = tmActions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every action has a title, group, when, and run", () => {
    for (const action of tmActions) {
      expect(typeof action.title).toBe("string");
      expect(typeof action.group).toBe("string");
      expect(typeof action.when).toBe("function");
      expect(typeof action.run).toBe("function");
    }
  });

  it("TM_TOOL_IDS lists exactly the 4 tool actions, in order", () => {
    expect(TM_TOOL_IDS).toEqual(["tool.select", "tool.createState", "tool.createTransition", "tool.delete"]);
  });

  it("re-exports the same keybindingOf as commands/registry.js", () => {
    expect(keybindingOf).toBe(fromRegistry);
  });
});

describe("findTmAction / findTmActionByKeybinding", () => {
  it("finds an action by id", () => {
    expect(findTmAction("tool.select")?.id).toBe("tool.select");
  });

  it("returns undefined for an unknown id", () => {
    expect(findTmAction("nope")).toBeUndefined();
  });

  it("finds an action by keybinding", () => {
    expect(findTmActionByKeybinding("s")?.id).toBe("tool.createState");
    expect(findTmActionByKeybinding("ctrl+z")?.id).toBe("edit.undo");
  });

  it("returns undefined for an unbound key", () => {
    expect(findTmActionByKeybinding("z")).toBeUndefined();
  });
});

describe("tool actions", () => {
  it("each tool.* action calls ctx.setTool with the matching tool id", () => {
    const ctx = fakeCtx();
    findTmAction("tool.select").run(ctx);
    findTmAction("tool.createState").run(ctx);
    findTmAction("tool.createTransition").run(ctx);
    findTmAction("tool.delete").run(ctx);
    expect(ctx.setTool.mock.calls.map((c) => c[0])).toEqual(["select", "create-state", "create-transition", "delete"]);
  });

  it("tool actions are always available (when() is true with no selection)", () => {
    const ctx = fakeCtx();
    for (const id of TM_TOOL_IDS) {
      expect(findTmAction(id).when(ctx)).toBe(true);
    }
  });
});

describe("state.rename", () => {
  it("is only available when a state is selected", () => {
    expect(findTmAction("state.rename").when(fakeCtx())).toBe(false);
    expect(findTmAction("state.rename").when(fakeCtx({ selection: { kind: "state", id: 1 } }))).toBe(true);
    expect(findTmAction("state.rename").when(fakeCtx({ selection: { kind: "transition", id: 1 } }))).toBe(false);
  });

  it("prompts for a label and renames when one is given", async () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 3 }, promptLabel: vi.fn().mockResolvedValue("q1") });
    await findTmAction("state.rename").run(ctx);
    expect(ctx.promptLabel).toHaveBeenCalledWith(3);
    expect(ctx.renameState).toHaveBeenCalledWith(3, "q1");
  });

  it("does nothing when the prompt is cancelled", async () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 3 } });
    await findTmAction("state.rename").run(ctx);
    expect(ctx.renameState).not.toHaveBeenCalled();
  });
});

describe("state.markInitial", () => {
  it("is only available when a state is selected", () => {
    expect(findTmAction("state.markInitial").when(fakeCtx())).toBe(false);
    expect(findTmAction("state.markInitial").when(fakeCtx({ selection: { kind: "state", id: 2 } }))).toBe(true);
  });

  it("applies a SetInitial op for the selected state", () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 2 } });
    findTmAction("state.markInitial").run(ctx);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "SetInitial", id: 2 }]);
  });
});

describe("state.toggleAccepting", () => {
  it("is only available when a state is selected", () => {
    expect(findTmAction("state.toggleAccepting").when(fakeCtx())).toBe(false);
    expect(findTmAction("state.toggleAccepting").when(fakeCtx({ selection: { kind: "state", id: 4 } }))).toBe(true);
  });

  it("flips accepting from false to true with no prompt involved", async () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 4 } });
    ctx.docStore.getState.mockReturnValue({ id: 4, accepting: false });
    await findTmAction("state.toggleAccepting").run(ctx);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "SetAccepting", id: 4, accepting: true }]);
  });

  it("flips accepting from true to false", async () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 4 } });
    ctx.docStore.getState.mockReturnValue({ id: 4, accepting: true });
    await findTmAction("state.toggleAccepting").run(ctx);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "SetAccepting", id: 4, accepting: false }]);
  });
});

describe("transition.edit", () => {
  it("is only available when a transition is selected", () => {
    expect(findTmAction("transition.edit").when(fakeCtx())).toBe(false);
    expect(findTmAction("transition.edit").when(fakeCtx({ selection: { kind: "transition", id: 7 } }))).toBe(true);
  });

  it("prompts one field per tape, pre-filled with the existing transition, and applies EditTransition", async () => {
    const promptTape = vi.fn().mockResolvedValue("b ; c , L");
    const ctx = fakeCtx({
      selection: { kind: "transition", id: 7 },
      promptTape,
      docStore: {
        derived: { alphabet: [], tape_count: 1, deterministic: true, unreachable: [] },
        apply: vi.fn().mockResolvedValue({ revision: 1, patches: [], derived: {} }),
        getState: vi.fn(),
        getTransition: vi.fn(),
      },
    });
    ctx.docStore.getTransition.mockReturnValue({
      id: 7,
      from: 1,
      to: 2,
      tapes: [{ read: "a", write: "a", direction: "S" }],
    });

    await findTmAction("transition.edit").run(ctx);

    expect(promptTape).toHaveBeenCalledWith(0, "a ; a , S");
    expect(ctx.docStore.apply).toHaveBeenCalledWith([
      { op: "EditTransition", id: 7, tapes: [{ read: "b", write: "c", direction: "L" }] },
    ]);
  });

  it("aborts with no op applied when the tape prompt is cancelled", async () => {
    const ctx = fakeCtx({
      selection: { kind: "transition", id: 7 },
      promptTape: vi.fn().mockResolvedValue(null),
    });
    ctx.docStore.getTransition.mockReturnValue({ id: 7, from: 1, to: 2, tapes: [{ read: "a", write: "a", direction: "S" }] });

    await findTmAction("transition.edit").run(ctx);

    expect(ctx.docStore.apply).not.toHaveBeenCalled();
  });
});

describe("promptTransitionTapes", () => {
  it("returns null and stops immediately when the first tape's prompt is cancelled", async () => {
    const ctx = fakeCtx({ promptTape: vi.fn().mockResolvedValue(null) });
    expect(await promptTransitionTapes(ctx)).toBeNull();
    expect(ctx.promptTape).toHaveBeenCalledTimes(1);
  });

  it("aborts the whole op when cancelled midway through a 2-tape flow, without prompting the rest", async () => {
    const ctx = fakeCtx({
      tapeCountChoice: 2,
      promptTape: vi.fn().mockImplementation(async (index) => (index === 0 ? "a ; a , S" : null)),
    });
    expect(await promptTransitionTapes(ctx)).toBeNull();
    expect(ctx.promptTape).toHaveBeenCalledTimes(2);
  });

  it("returns the parsed tapes for a 2-tape flow, blank fields defaulting to the blank glyph", async () => {
    const ctx = fakeCtx({
      tapeCountChoice: 2,
      promptTape: vi.fn().mockImplementation(async (index) => (index === 0 ? "a ; b , R" : " ; , ")),
    });
    const result = await promptTransitionTapes(ctx);
    expect(result).toEqual({
      tapes: [
        { read: "a", write: "b", direction: "R" },
        { read: "□", write: "□", direction: "S" },
      ],
    });
  });

  it("uses the locked docStore.derived.tape_count over ctx.tapeCountChoice once locked", async () => {
    const ctx = fakeCtx({
      tapeCountChoice: 1,
      docStore: {
        derived: { alphabet: [], tape_count: 2, deterministic: true, unreachable: [] },
        apply: vi.fn(),
        getState: vi.fn(),
        getTransition: vi.fn(),
      },
      promptTape: vi.fn().mockResolvedValue("a ; a , S"),
    });
    await promptTransitionTapes(ctx);
    expect(ctx.promptTape).toHaveBeenCalledTimes(2);
  });
});

describe("edit.deleteSelection", () => {
  it("is only available when something is selected", () => {
    expect(findTmAction("edit.deleteSelection").when(fakeCtx())).toBe(false);
    expect(findTmAction("edit.deleteSelection").when(fakeCtx({ selection: { kind: "state", id: 1 } }))).toBe(true);
  });

  it("removes a selected state via RemoveState", () => {
    const ctx = fakeCtx({ selection: { kind: "state", id: 5 } });
    findTmAction("edit.deleteSelection").run(ctx);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "RemoveState", id: 5 }]);
  });

  it("removes a selected transition via RemoveTransition, by its own id (not from/to — several can share endpoints)", () => {
    const ctx = fakeCtx({ selection: { kind: "transition", id: 9 } });
    findTmAction("edit.deleteSelection").run(ctx);
    expect(ctx.docStore.apply).toHaveBeenCalledWith([{ op: "RemoveTransition", id: 9 }]);
  });
});

describe("edit.undo / edit.redo", () => {
  it("always available and delegate to docStore", () => {
    const ctx = fakeCtx();
    expect(findTmAction("edit.undo").when(ctx)).toBe(true);
    expect(findTmAction("edit.redo").when(ctx)).toBe(true);
    findTmAction("edit.undo").run(ctx);
    findTmAction("edit.redo").run(ctx);
    expect(ctx.docStore.undo).toHaveBeenCalled();
    expect(ctx.docStore.redo).toHaveBeenCalled();
  });
});

describe("TM_MENU_GROUP_TITLES (PR11: main.js composes the shared MenuBar per active tab kind)", () => {
  it("maps only the edit group to a menu title — no view/testing/interop/convert group yet", () => {
    expect(TM_MENU_GROUP_TITLES).toEqual({ edit: "Editar" });
  });
});
