import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectActions } from "./projectRegistry.js";
import { ProjectContext } from "./ProjectContext.js";
import { ProjectStore } from "../project/ProjectStore.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

function fakeCtx(overrides = {}) {
  const projectStore = new ProjectStore({
    projectNew: vi.fn().mockResolvedValue({ tabs: [], revision: 0 }),
    projectManifest: vi.fn(),
    projectNewTab: vi.fn().mockResolvedValue({ tabs: [{ id: 0, kind: "Fa", name: "A", revision: 0 }], revision: 0 }),
    projectCloseTab: vi.fn().mockResolvedValue({ tabs: [], revision: 0 }),
    projectRenameTab: vi.fn().mockResolvedValue({ tabs: [{ id: 0, kind: "Fa", name: "R", revision: 0 }], revision: 0 }),
    projectReorderTab: vi.fn(),
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

  it("includes project.new, project.open, project.save, project.saveAs and exactly one project.newTab action", () => {
    const ids = projectActions.map((a) => a.id);
    expect(ids).toContain("project.new");
    expect(ids).toContain("project.open");
    expect(ids).toContain("project.save");
    expect(ids).toContain("project.saveAs");
    expect(ids.filter((id) => id === "project.newTab")).toHaveLength(1);
  });
});

describe("project.new / project.open — unsaved-changes guard (confirmDiscardIfDirty)", () => {
  /** Makes `ctx`'s store report dirty without going through a real
   * edit/apply round-trip — `ProjectStore.tabs` is a plain public array, so
   * directly giving it one tab whose own `revision` differs from the
   * (default 0) `savedRevision` baseline is the most direct way to set this
   * up for a unit test. */
  function makeDirty(ctx) {
    ctx.projectStore.tabs = [{ id: 0, kind: "Fa", name: "A", revision: 1 }];
  }

  it("project.new proceeds directly, without asking, when the project is clean", async () => {
    const confirmDiscard = vi.fn();
    const ctx = fakeCtx({ confirmDiscard });
    const action = projectActions.find((a) => a.id === "project.new");

    await action.run(ctx);

    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(ctx.projectStore.client.projectNew).toHaveBeenCalled();
  });

  it("project.new does not proceed when the project is dirty and the user cancels", async () => {
    const confirmDiscard = vi.fn().mockResolvedValue("cancel");
    const ctx = fakeCtx({ confirmDiscard });
    makeDirty(ctx);
    const action = projectActions.find((a) => a.id === "project.new");

    await action.run(ctx);

    expect(confirmDiscard).toHaveBeenCalled();
    expect(ctx.projectStore.client.projectNew).not.toHaveBeenCalled();
  });

  it("project.new proceeds without saving when the project is dirty and the user picks discard", async () => {
    const confirmDiscard = vi.fn().mockResolvedValue("discard");
    const ctx = fakeCtx({ confirmDiscard });
    makeDirty(ctx);
    const action = projectActions.find((a) => a.id === "project.new");

    await action.run(ctx);

    expect(ctx.projectStore.client.projectSave).not.toHaveBeenCalled();
    expect(ctx.projectStore.client.projectNew).toHaveBeenCalled();
  });

  it("project.new saves to the already-known filePath (no path prompt) then proceeds when the user picks save", async () => {
    const confirmDiscard = vi.fn().mockResolvedValue("save");
    const promptPath = vi.fn();
    const ctx = fakeCtx({ confirmDiscard, promptPath });
    makeDirty(ctx);
    ctx.projectStore.filePath = "/already-open.jflapproj";
    const action = projectActions.find((a) => a.id === "project.new");

    await action.run(ctx);

    expect(promptPath).not.toHaveBeenCalled();
    expect(ctx.projectStore.client.projectSave).toHaveBeenCalledWith("/already-open.jflapproj");
    expect(ctx.projectStore.client.projectNew).toHaveBeenCalled();
  });

  it("project.new prompts for a path, saves, then proceeds when picking save on a never-yet-saved project", async () => {
    const confirmDiscard = vi.fn().mockResolvedValue("save");
    const ctx = fakeCtx({ confirmDiscard });
    makeDirty(ctx);
    const action = projectActions.find((a) => a.id === "project.new");

    await action.run(ctx);

    expect(ctx.projectStore.client.projectSave).toHaveBeenCalledWith("/x.jflapproj");
    expect(ctx.projectStore.client.projectNew).toHaveBeenCalled();
  });

  it("project.new does not proceed when picking save but then cancelling the path prompt", async () => {
    const confirmDiscard = vi.fn().mockResolvedValue("save");
    const promptPath = vi.fn().mockResolvedValue(null);
    const ctx = fakeCtx({ confirmDiscard, promptPath });
    makeDirty(ctx);
    const action = projectActions.find((a) => a.id === "project.new");

    await action.run(ctx);

    expect(ctx.projectStore.client.projectSave).not.toHaveBeenCalled();
    expect(ctx.projectStore.client.projectNew).not.toHaveBeenCalled();
  });

  it("project.open applies the same guard, then still prompts for which project to open", async () => {
    const confirmDiscard = vi.fn().mockResolvedValue("discard");
    const ctx = fakeCtx({ confirmDiscard });
    makeDirty(ctx);
    const action = projectActions.find((a) => a.id === "project.open");

    await action.run(ctx);

    expect(confirmDiscard).toHaveBeenCalled();
    expect(ctx.projectStore.client.projectOpen).toHaveBeenCalledWith("/x.jflapproj");
  });

  it("project.open never prompts for which project to open when the guard cancels", async () => {
    const confirmDiscard = vi.fn().mockResolvedValue("cancel");
    const ctx = fakeCtx({ confirmDiscard });
    makeDirty(ctx);
    const action = projectActions.find((a) => a.id === "project.open");

    await action.run(ctx);

    expect(ctx.projectStore.client.projectOpen).not.toHaveBeenCalled();
  });

  it("project.closeTab closes directly, without asking, when that tab is clean", async () => {
    const confirmDiscard = vi.fn();
    const ctx = fakeCtx({ confirmDiscard });
    ctx.projectStore.tabs = [{ id: 0, kind: "Fa", name: "A", revision: 0 }];
    ctx.projectStore._tabSavedRevision.set(0, 0); // baseline matches live revision — clean
    ctx.projectStore.activeTabId = 0;
    const action = projectActions.find((a) => a.id === "project.closeTab");

    await action.run(ctx);

    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(ctx.projectStore.client.projectCloseTab).toHaveBeenCalledWith(0);
  });

  it("project.closeTab asks and does not close when the active tab is dirty and the user cancels", async () => {
    const confirmDiscard = vi.fn().mockResolvedValue("cancel");
    const ctx = fakeCtx({ confirmDiscard });
    makeDirty(ctx);
    ctx.projectStore.activeTabId = 0;
    const action = projectActions.find((a) => a.id === "project.closeTab");

    await action.run(ctx);

    expect(confirmDiscard).toHaveBeenCalled();
    expect(ctx.projectStore.client.projectCloseTab).not.toHaveBeenCalled();
  });

  it("project.closeTab closes without saving when the user picks discard", async () => {
    const confirmDiscard = vi.fn().mockResolvedValue("discard");
    const ctx = fakeCtx({ confirmDiscard });
    makeDirty(ctx);
    ctx.projectStore.activeTabId = 0;
    const action = projectActions.find((a) => a.id === "project.closeTab");

    await action.run(ctx);

    expect(ctx.projectStore.client.projectSave).not.toHaveBeenCalled();
    expect(ctx.projectStore.client.projectCloseTab).toHaveBeenCalledWith(0);
  });

  it("project.closeTab saves the whole project first, then closes the tab, when the user picks save", async () => {
    const confirmDiscard = vi.fn().mockResolvedValue("save");
    const ctx = fakeCtx({ confirmDiscard });
    makeDirty(ctx);
    ctx.projectStore.activeTabId = 0;
    ctx.projectStore.filePath = "/already-open.jflapproj";
    const action = projectActions.find((a) => a.id === "project.closeTab");

    await action.run(ctx);

    expect(ctx.projectStore.client.projectSave).toHaveBeenCalledWith("/already-open.jflapproj");
    expect(ctx.projectStore.client.projectCloseTab).toHaveBeenCalledWith(0);
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

  it("project.save's run prompts for a path on a never-yet-saved project (filePath is null)", async () => {
    const add = vi.fn();
    const ctx = fakeCtx({ recentProjects: { list: () => [], add } });
    expect(ctx.projectStore.filePath).toBeNull();
    const action = projectActions.find((a) => a.id === "project.save");

    await action.run(ctx);

    expect(ctx.projectStore.client.projectSave).toHaveBeenCalledWith("/x.jflapproj");
    expect(add).toHaveBeenCalledWith("/x.jflapproj");
  });

  it("project.save's run silently overwrites the project's known filePath, without prompting again", async () => {
    const ctx = fakeCtx();
    ctx.projectStore.filePath = "/already-open.jflapproj";
    const action = projectActions.find((a) => a.id === "project.save");

    await action.run(ctx);

    expect(ctx.promptPath).not.toHaveBeenCalled();
    expect(ctx.projectStore.client.projectSave).toHaveBeenCalledWith("/already-open.jflapproj");
  });

  it("project.saveAs's run always prompts for a path, even when filePath is already known", async () => {
    const ctx = fakeCtx();
    ctx.projectStore.filePath = "/already-open.jflapproj";
    const action = projectActions.find((a) => a.id === "project.saveAs");

    await action.run(ctx);

    expect(ctx.promptPath).toHaveBeenCalledWith("save-project");
    expect(ctx.projectStore.client.projectSave).toHaveBeenCalledWith("/x.jflapproj");
  });

  it("project.saveAs's run does nothing when the path prompt is cancelled", async () => {
    const ctx = fakeCtx({ promptPath: vi.fn().mockResolvedValue(null) });
    const action = projectActions.find((a) => a.id === "project.saveAs");

    await action.run(ctx);

    expect(ctx.projectStore.client.projectSave).not.toHaveBeenCalled();
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

describe("project actions surface backend failures as a visible notice (follow-up fix)", () => {
  // Tauri's Err(String) rejects the JS promise with a plain string, not an
  // Error instance — asserting against a plain-string rejection (not
  // `new Error(...)`) matches that real failure shape.

  it("project.open shows a notice and does not add the path to Recientes when it fails", async () => {
    const add = vi.fn();
    const ctx = fakeCtx({ recentProjects: { list: () => [], add } });
    ctx.projectStore.client.projectOpen = vi.fn().mockRejectedValue("failed to read /x.jflapproj: not found");
    const action = projectActions.find((a) => a.id === "project.open");

    await action.run(ctx);

    const notice = document.querySelector(".notice");
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain("not found");
    expect(add).not.toHaveBeenCalled();
  });

  it("project.recent's submenu entry shows a notice when the stored path no longer opens", async () => {
    const ctx = fakeCtx({ recentProjects: { list: () => ["/gone.jflapproj"], add: vi.fn() } });
    ctx.projectStore.client.projectOpen = vi.fn().mockRejectedValue("failed to read /gone.jflapproj: not found");
    const recent = projectActions.find((a) => a.id === "project.recent");
    const [item] = recent.submenu.items(ctx);

    await item.run(ctx);

    const notice = document.querySelector(".notice");
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain("not found");
  });

  it("project.save (via Guardar) shows a notice and stays dirty when the write fails", async () => {
    const ctx = fakeCtx();
    ctx.projectStore.client.projectSave = vi.fn().mockRejectedValue("permission denied");
    ctx.projectStore.filePath = "/already-open.jflapproj";
    const action = projectActions.find((a) => a.id === "project.save");

    const result = await action.run(ctx);

    expect(result).toBe(false);
    const notice = document.querySelector(".notice");
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain("permission denied");
  });

  it("project.saveAs shows a notice when the write fails", async () => {
    const ctx = fakeCtx();
    ctx.projectStore.client.projectSave = vi.fn().mockRejectedValue("disk full");
    const action = projectActions.find((a) => a.id === "project.saveAs");

    await action.run(ctx);

    const notice = document.querySelector(".notice");
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain("disk full");
  });

  it("project.newTab shows a notice when the backend rejects a duplicate/empty name", async () => {
    const ctx = fakeCtx();
    ctx.projectStore.client.projectNewTab = vi.fn().mockRejectedValue('a tab named "A" already exists');
    const action = projectActions.find((a) => a.id === "project.newTab");

    await action.run(ctx);

    const notice = document.querySelector(".notice");
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain("already exists");
  });

  it("project.renameTab shows a notice when the backend rejects a duplicate/empty name", async () => {
    const ctx = fakeCtx();
    ctx.projectStore.client.projectRenameTab = vi.fn().mockRejectedValue('a tab named "B" already exists');
    ctx.projectStore.tabs = [{ id: 0, kind: "Fa", name: "A", revision: 0 }];
    ctx.projectStore.activeTabId = 0;
    const action = projectActions.find((a) => a.id === "project.renameTab");

    await action.run(ctx);

    const notice = document.querySelector(".notice");
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain("already exists");
  });
});
