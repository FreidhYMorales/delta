import { describe, expect, it, vi } from "vitest";
import { ViewContext } from "./context.js";

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
});
