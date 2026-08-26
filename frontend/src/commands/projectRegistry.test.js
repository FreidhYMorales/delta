import { describe, expect, it, vi } from "vitest";
import { projectActions } from "./projectRegistry.js";
import { ProjectContext } from "./ProjectContext.js";
import { ProjectStore } from "../project/ProjectStore.js";

function fakeCtx(overrides = {}) {
  const projectStore = new ProjectStore({
    projectNew: vi.fn().mockResolvedValue({ tabs: [], revision: 0 }),
    projectManifest: vi.fn(),
    projectNewTab: vi.fn().mockResolvedValue({ tabs: [{ id: 0, kind: "Fa", name: "A", revision: 0 }], revision: 0 }),
    projectCloseTab: vi.fn().mockResolvedValue({ tabs: [], revision: 0 }),
    projectRenameTab: vi.fn().mockResolvedValue({ tabs: [{ id: 0, kind: "Fa", name: "R", revision: 0 }], revision: 0 }),
    projectOpen: vi.fn().mockResolvedValue({ tabs: [], revision: 0 }),
    projectSave: vi.fn().mockResolvedValue({ tabs: [], revision: 0 }),
  });
  const ctx = new ProjectContext(projectStore, {
    promptPath: vi.fn().mockResolvedValue("/x.jflapproj"),
    promptTabName: vi.fn().mockResolvedValue("New tab"),
    promptNewTab: vi.fn().mockResolvedValue({ kind: "Mealy", name: "New tab" }),
    ...overrides,
  });
  return ctx;
}

describe("projectActions structural shape (design D8, mirrors registry.js's own guarantees)", () => {
  it("every static action has the {id,title,group,keybinding,when,run} shape", () => {
    expect(projectActions.length).toBeGreaterThan(0);
    for (const action of projectActions) {
      expect(typeof action.id).toBe("string");
      expect(action.id.length).toBeGreaterThan(0);
      expect(typeof action.title).toBe("string");
      expect(typeof action.group).toBe("string");
      expect(action.keybinding === null || typeof action.keybinding === "string").toBe(true);
      expect(typeof action.when).toBe("function");
      // The dynamic "Recientes" entry is the one documented exception
      // (design D8): it has a `submenu` instead of a `run`.
      if (!action.submenu) expect(typeof action.run).toBe("function");
    }
  });

  it("has unique action ids", () => {
    const ids = projectActions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes project.new, project.open, project.save and exactly one project.newTab action", () => {
    const ids = projectActions.map((a) => a.id);
    expect(ids).toContain("project.new");
    expect(ids).toContain("project.open");
    expect(ids).toContain("project.save");
    expect(ids.filter((id) => id === "project.newTab")).toHaveLength(1);
  });
});

describe("'Recientes' — the one dynamic exception (design D8)", () => {
  it("is a submenu with items(ctx), not a plain static run action", () => {
    const recent = projectActions.find((a) => a.id === "project.recent");
    expect(recent).toBeDefined();
    expect(recent.run).toBeUndefined();
    expect(recent.submenu).toBeDefined();
    expect(typeof recent.submenu.items).toBe("function");
  });

  it("items(ctx) reflects ctx.recentProjects' current list", () => {
    const recent = projectActions.find((a) => a.id === "project.recent");
    const ctx = fakeCtx({ recentProjects: { list: () => ["/a.jflapproj", "/b.jflapproj"], add: vi.fn() } });

    const items = recent.submenu.items(ctx);

    expect(items.map((i) => i.title)).toEqual(["/a.jflapproj", "/b.jflapproj"]);
    for (const item of items) {
      expect(typeof item.run).toBe("function");
    }
  });

  it("items(ctx) is an empty array when no recents are wired, never throws", () => {
    const recent = projectActions.find((a) => a.id === "project.recent");
    const ctx = fakeCtx();

    expect(recent.submenu.items(ctx)).toEqual([]);
  });
});

describe("reachability without any FA-specific context field (design D8)", () => {
  it("every when(ctx) evaluates without throwing against a context that has no FA fields at all", () => {
    const ctx = fakeCtx();
    // Sanity: this fake context intentionally has no `docStore`/`selection`
    // (the FA-only `ViewContext` fields) — proving `when` never reaches for
    // them.
    expect(ctx.docStore).toBeUndefined();
    expect(ctx.selection).toBeUndefined();

    for (const action of projectActions) {
      expect(() => action.when(ctx)).not.toThrow();
    }
  });

  it("project.new's run works end-to-end against the injected projectStore", async () => {
    const ctx = fakeCtx();
    const action = projectActions.find((a) => a.id === "project.new");

    await action.run(ctx);

    expect(ctx.projectStore.tabs).toEqual([]);
  });

  it("project.open's run prompts a path and opens it, recording it as recent", async () => {
    const add = vi.fn();
    const ctx = fakeCtx({ recentProjects: { list: () => [], add } });
    const action = projectActions.find((a) => a.id === "project.open");

    await action.run(ctx);

    expect(ctx.projectStore.client.projectOpen).toHaveBeenCalledWith("/x.jflapproj");
    expect(add).toHaveBeenCalledWith("/x.jflapproj");
  });

  it("project.newTab's run prompts a kind+name and creates a tab of that kind", async () => {
    const ctx = fakeCtx();
    const action = projectActions.find((a) => a.id === "project.newTab");

    await action.run(ctx);

    expect(ctx.projectStore.client.projectNewTab).toHaveBeenCalledWith("Mealy", "New tab");
  });

  it("project.newTab's run does nothing when the modal is cancelled", async () => {
    const ctx = fakeCtx({ promptNewTab: vi.fn().mockResolvedValue(null) });
    const action = projectActions.find((a) => a.id === "project.newTab");

    await action.run(ctx);

    expect(ctx.projectStore.client.projectNewTab).not.toHaveBeenCalled();
  });
});
