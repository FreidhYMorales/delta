import { beforeEach, describe, expect, it, vi } from "vitest";
import { MooreContext } from "./MooreContext.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("MooreContext", () => {
  it("defaults to the select tool and no selection", () => {
    const ctx = new MooreContext({});
    expect(ctx.activeTool).toBe("select");
    expect(ctx.selection).toBeNull();
  });

  it("setTool switches the active tool, clears selection and notifies subscribers", () => {
    const ctx = new MooreContext({});
    const listener = vi.fn();
    ctx.subscribe(listener);

    ctx.setSelection({ kind: "state", id: 1 });
    ctx.setTool("create-state");

    expect(ctx.activeTool).toBe("create-state");
    expect(ctx.selection).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("setSelection updates selection and notifies", () => {
    const ctx = new MooreContext({});
    const listener = vi.fn();
    ctx.subscribe(listener);

    ctx.setSelection({ kind: "state", id: 5 });

    expect(ctx.selection).toEqual({ kind: "state", id: 5 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("clearSelection sets selection back to null", () => {
    const ctx = new MooreContext({});
    ctx.setSelection({ kind: "state", id: 1 });
    ctx.clearSelection();
    expect(ctx.selection).toBeNull();
  });

  it("unsubscribe stops further notifications", () => {
    const ctx = new MooreContext({});
    const listener = vi.fn();
    const unsubscribe = ctx.subscribe(listener);
    unsubscribe();
    ctx.setSelection({ kind: "state", id: 1 });
    expect(listener).not.toHaveBeenCalled();
  });

  it("exposes promptLabel/promptInput/promptOutput defaulting to null, no real prompt", async () => {
    const ctx = new MooreContext({});
    expect(await ctx.promptLabel(1)).toBeNull();
    expect(await ctx.promptInput()).toBeNull();
    expect(await ctx.promptOutput(1)).toBeNull();
  });

  it("exposes openFile/saveFile defaulting to safe no-ops", async () => {
    const ctx = new MooreContext({});
    await expect(ctx.openFile()).resolves.toBeUndefined();
    await expect(ctx.saveFile()).resolves.toBeUndefined();
  });
});

describe("MooreContext.renameState default (same collision-notice rule as MealyContext's)", () => {
  function fakeDocStore(applyResult) {
    return {
      getState: vi.fn((id) => (id === 1 ? { id: 1, label: "A" } : undefined)),
      apply: vi.fn().mockResolvedValue(applyResult),
    };
  }

  it("returns true and shows no notice when the rename actually happened", async () => {
    const docStore = fakeDocStore({ revision: 2, patches: [{ patch: "StateRenamed", id: 1, label: "Z" }], derived: {} });
    const ctx = new MooreContext(docStore);

    const ok = await ctx.renameState(1, "Z");

    expect(ok).toBe(true);
    expect(docStore.apply).toHaveBeenCalledWith([{ op: "RenameState", id: 1, label: "Z" }]);
    expect(document.querySelector(".notice")).toBeNull();
  });

  it("returns false and shows a visible notice when the rename is blocked (no StateRenamed patch)", async () => {
    const docStore = fakeDocStore({ revision: 2, patches: [], derived: {} });
    const ctx = new MooreContext(docStore);

    const ok = await ctx.renameState(1, "B");

    expect(ok).toBe(false);
    const notice = document.querySelector(".notice");
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain("already used");
  });

  it("a caller-provided renameState hook overrides the default entirely", async () => {
    const renameState = vi.fn().mockResolvedValue(true);
    const docStore = fakeDocStore({ revision: 2, patches: [], derived: {} });
    const ctx = new MooreContext(docStore, { renameState });

    const ok = await ctx.renameState(1, "B");

    expect(ok).toBe(true);
    expect(docStore.apply).not.toHaveBeenCalled();
  });
});
