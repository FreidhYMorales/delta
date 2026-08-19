import { beforeEach, describe, expect, it, vi } from "vitest";
import { ViewContext } from "./context.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("ViewContext", () => {
  it("defaults to the select tool and no selection", () => {
    const ctx = new ViewContext({});
    expect(ctx.activeTool).toBe("select");
    expect(ctx.selection).toBeNull();
  });

  it("setTool switches the active tool, clears selection and notifies subscribers", () => {
    const ctx = new ViewContext({});
    const listener = vi.fn();
    ctx.subscribe(listener);

    ctx.setSelection({ kind: "state", id: 1 });
    ctx.setTool("create-state");

    expect(ctx.activeTool).toBe("create-state");
    expect(ctx.selection).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("setSelection updates selection and notifies", () => {
    const ctx = new ViewContext({});
    const listener = vi.fn();
    ctx.subscribe(listener);

    ctx.setSelection({ kind: "state", id: 5 });

    expect(ctx.selection).toEqual({ kind: "state", id: 5 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("clearSelection is a no-op notify-wise if already empty is still explicit", () => {
    const ctx = new ViewContext({});
    ctx.setSelection({ kind: "state", id: 1 });
    ctx.clearSelection();
    expect(ctx.selection).toBeNull();
  });

  it("unsubscribe stops further notifications", () => {
    const ctx = new ViewContext({});
    const listener = vi.fn();
    const unsubscribe = ctx.subscribe(listener);
    unsubscribe();

    ctx.setSelection({ kind: "state", id: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("exposes injectable hooks with safe no-op defaults", async () => {
    const ctx = new ViewContext({});
    expect(await ctx.promptPath("open-jff")).toBeNull();
    expect(await ctx.promptLabel(1)).toBeNull();
    expect(await ctx.promptSymbol()).toBeNull();
    await expect(ctx.importJff("/x")).resolves.toBeUndefined();
    await expect(ctx.exportJff("/x")).resolves.toBeUndefined();
    expect(() => ctx.viewport.zoomIn()).not.toThrow();
    expect(() => ctx.layout.circle()).not.toThrow();
  });

  it("uses provided hooks over the defaults", () => {
    const promptLabel = vi.fn().mockReturnValue("q9");
    const ctx = new ViewContext({}, { promptLabel });
    expect(ctx.promptLabel(1)).toBe("q9");
    expect(promptLabel).toHaveBeenCalledWith(1);
  });

  it("exposes L2 testing hooks with safe no-op defaults", async () => {
    const ctx = new ViewContext({});
    expect(await ctx.simTrace(["a"])).toEqual({ outcome: "Rejected", steps: [] });
    expect(await ctx.simBatch([["a"]])).toEqual([]);
    expect(() => ctx.testing.openSingle()).not.toThrow();
    expect(() => ctx.testing.openBatch()).not.toThrow();
  });

  it("exposes a toRegex hook defaulting to the empty language", async () => {
    const ctx = new ViewContext({});
    expect(await ctx.toRegex()).toBe("∅");
  });
});

describe("ViewContext.renameState default (task 7.9: rename collisions are never silent)", () => {
  function fakeDocStore(applyResult) {
    return {
      getState: vi.fn((id) => (id === 1 ? { id: 1, label: "A" } : undefined)),
      apply: vi.fn().mockResolvedValue(applyResult),
    };
  }

  it("returns true and shows no notice when the rename actually happened", async () => {
    const docStore = fakeDocStore({
      revision: 2,
      patches: [{ patch: "StateRenamed", id: 1, label: "Z" }],
      derived: {},
    });
    const ctx = new ViewContext(docStore);

    const ok = await ctx.renameState(1, "Z");

    expect(ok).toBe(true);
    expect(docStore.apply).toHaveBeenCalledWith([{ op: "RenameState", id: 1, label: "Z" }]);
    expect(document.querySelector(".notice")).toBeNull();
  });

  it("returns false and shows a visible notice when doc_apply blocks the rename (no StateRenamed patch)", async () => {
    // Mirrors `Document::apply`'s real behavior on a name collision: it
    // still returns Ok with a bumped revision, just zero patches for the
    // blocked op (`crates/automata-core/src/doc/mod.rs`) — never an `Err`.
    const docStore = fakeDocStore({ revision: 2, patches: [], derived: {} });
    const ctx = new ViewContext(docStore);

    const ok = await ctx.renameState(1, "B");

    expect(ok).toBe(false);
    const notice = document.querySelector(".notice");
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain("already used");
  });

  it("a caller-provided renameState hook overrides the default entirely", async () => {
    const renameState = vi.fn().mockResolvedValue(true);
    const docStore = fakeDocStore({ revision: 2, patches: [], derived: {} });
    const ctx = new ViewContext(docStore, { renameState });

    await ctx.renameState(1, "Z");

    expect(renameState).toHaveBeenCalledWith(1, "Z");
    expect(docStore.apply).not.toHaveBeenCalled();
  });
});
