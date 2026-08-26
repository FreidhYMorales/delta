import { describe, expect, it, vi } from "vitest";
import { ProjectContext } from "./ProjectContext.js";
import { ProjectStore } from "../project/ProjectStore.js";

function fakeProjectStore() {
  return new ProjectStore({
    projectNew: vi.fn(),
    projectManifest: vi.fn(),
    projectNewTab: vi.fn(),
    projectCloseTab: vi.fn(),
    projectRenameTab: vi.fn(),
    projectOpen: vi.fn(),
    projectSave: vi.fn(),
  });
}

describe("ProjectContext (design D8)", () => {
  it("exposes the injected projectStore", () => {
    const projectStore = fakeProjectStore();
    const ctx = new ProjectContext(projectStore);
    expect(ctx.projectStore).toBe(projectStore);
  });

  it("defaults promptPath/promptTabName to a no-op resolving null, safe without a real dialog hook", async () => {
    const ctx = new ProjectContext(fakeProjectStore());
    expect(await ctx.promptPath("open-project")).toBeNull();
    expect(await ctx.promptTabName("Fa")).toBeNull();
  });

  it("defaults recentProjects to null (no recents list wired) rather than throwing", () => {
    const ctx = new ProjectContext(fakeProjectStore());
    expect(ctx.recentProjects).toBeNull();
  });

  it("accepts injected hooks, overriding the defaults", async () => {
    const promptPath = vi.fn().mockResolvedValue("/picked.jflapproj");
    const recentProjects = { list: () => ["/a"], add: vi.fn() };
    const ctx = new ProjectContext(fakeProjectStore(), { promptPath, recentProjects });

    expect(await ctx.promptPath("save-project")).toBe("/picked.jflapproj");
    expect(ctx.recentProjects).toBe(recentProjects);
  });

  it("subscribe/notify works the same shape as ViewContext", () => {
    const ctx = new ProjectContext(fakeProjectStore());
    const listener = vi.fn();
    const unsubscribe = ctx.subscribe(listener);

    ctx._notify();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    ctx._notify();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("forwards the injected projectStore's own notifications to its own subscribers (PR10: MenuBar's tabs section re-renders live)", async () => {
    const projectStore = fakeProjectStore();
    const ctx = new ProjectContext(projectStore);
    const listener = vi.fn();
    ctx.subscribe(listener);

    projectStore.setActiveTab(0);

    expect(listener).toHaveBeenCalled();
  });
});
