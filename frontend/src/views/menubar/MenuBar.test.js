import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../../store/DocStore.js";
import { ViewContext } from "../../commands/context.js";
import { ProjectContext } from "../../commands/ProjectContext.js";
import { ProjectStore } from "../../project/ProjectStore.js";
import { actions } from "../../commands/registry.js";
import { projectActions, PROJECT_MENU_GROUP_TITLES } from "../../commands/projectRegistry.js";
import { MenuBar, MENU_GROUP_TITLES, formatKeybinding } from "./MenuBar.js";

function emptySnapshot() {
  return {
    revision: 1,
    states: [],
    edges: [],
    derived: { classification: "Dfa", alphabet: [], unreachable: [] },
  };
}

async function setupCtx(hooks = {}) {
  const client = {
    docSnapshot: vi.fn().mockResolvedValue(emptySnapshot()),
    docApply: vi.fn(),
    docUndo: vi.fn(),
    docRedo: vi.fn(),
  };
  const docStore = new DocStore(client);
  await docStore.load();
  return new ViewContext(docStore, {
    viewport: { zoomIn: vi.fn(), zoomOut: vi.fn(), reset: vi.fn(), fitToWindow: vi.fn() },
    layout: { arrange: vi.fn() },
    promptPath: vi.fn().mockResolvedValue("/tmp/x.jff"),
    importJff: vi.fn(),
    exportJff: vi.fn(),
    testing: { openSingle: vi.fn(), openBatch: vi.fn() },
    ...hooks,
  });
}

/** Builds the same 5 menus (Archivo/Editar/Ver/Convertir/Test) the OLD
 * single-source MenuBar built internally from `registry.js`'s `actions` —
 * now assembled by the CALLER (design D9), one section per registry group,
 * each carrying its own `ctx`. This is what lets `MenuBar.test.js`'s
 * existing per-action assertions keep holding under the new contract. */
function faMenus(ctx) {
  return Object.entries(MENU_GROUP_TITLES).map(([group, title]) => ({
    title,
    sections: [{ id: group, actions: actions.filter((a) => a.group === group), ctx }],
  }));
}

function projectMenus(ctx) {
  return Object.entries(PROJECT_MENU_GROUP_TITLES).map(([group, title]) => ({
    title,
    sections: [{ id: group, actions: projectActions.filter((a) => a.group === group), ctx }],
  }));
}

async function setup(hooks = {}) {
  const ctx = await setupCtx(hooks);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const menuBar = new MenuBar(container, faMenus(ctx));
  return { ctx, container, menuBar };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("formatKeybinding", () => {
  it("formats modifier + letter combos", () => {
    expect(formatKeybinding("ctrl+z")).toBe("Ctrl+Z");
    expect(formatKeybinding("ctrl+shift+z")).toBe("Ctrl+Shift+Z");
  });

  it("formats named keys and symbols", () => {
    expect(formatKeybinding("delete")).toBe("Delete");
    expect(formatKeybinding("f2")).toBe("F2");
    expect(formatKeybinding("ctrl+=")).toBe("Ctrl+=");
  });

  it("returns an empty string for null/undefined", () => {
    expect(formatKeybinding(null)).toBe("");
    expect(formatKeybinding(undefined)).toBe("");
  });
});

describe("MenuBar rendering (UI/UX audit: fixes 100%-unreachable actions)", () => {
  it("renders exactly the File / Edit / View / Test menu triggers, in that order", async () => {
    const { container } = await setup();
    const triggers = container.querySelectorAll(".menu-bar-item");
    expect([...triggers].map((b) => b.textContent)).toEqual(Object.values(MENU_GROUP_TITLES));
  });

  it("the File menu contains jff.import and jff.export (previously 100% unreachable)", async () => {
    const { container } = await setup();
    const items = container.querySelectorAll('[data-action^="jff."]');
    expect([...items].map((i) => i.dataset.action)).toEqual(["jff.import", "jff.export"]);
  });

  it("the Test menu contains test.singleTrace and test.batch (previously 100% unreachable)", async () => {
    const { container } = await setup();
    const items = container.querySelectorAll('[data-action^="test."]');
    expect([...items].map((i) => i.dataset.action)).toEqual(["test.singleTrace", "test.batch"]);
  });

  it("the Edit menu shows the undo keybinding hint", async () => {
    const { container } = await setup();
    const undoItem = container.querySelector('[data-action="edit.undo"]');
    expect(undoItem.querySelector(".menu-dropdown-item-hint").textContent).toBe("Ctrl+Z");
  });

  it("does not render the tools/state groups (already visible via toolbar/context menu)", async () => {
    const { container } = await setup();
    expect(container.querySelector('[data-action="tool.select"]')).toBeNull();
    expect(container.querySelector('[data-action="state.rename"]')).toBeNull();
  });
});

describe("MenuBar interaction", () => {
  it("opens a dropdown on trigger click and closes it on a second click", async () => {
    const { container } = await setup();
    const [fileTrigger] = container.querySelectorAll(".menu-bar-item");
    const dropdown = fileTrigger.parentElement.querySelector(".menu-dropdown");
    expect(dropdown.hidden).toBe(true);

    fileTrigger.click();
    expect(dropdown.hidden).toBe(false);

    fileTrigger.click();
    expect(dropdown.hidden).toBe(true);
  });

  it("closes the open dropdown on Escape", async () => {
    const { container } = await setup();
    const [fileTrigger] = container.querySelectorAll(".menu-bar-item");
    const dropdown = fileTrigger.parentElement.querySelector(".menu-dropdown");
    fileTrigger.click();
    expect(dropdown.hidden).toBe(false);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(dropdown.hidden).toBe(true);
  });

  it("clicking a menu item runs the action through the registry and closes the menu", async () => {
    const { container, ctx } = await setup();
    const undoItem = container.querySelector('[data-action="edit.undo"]');
    undoItem.closest(".menu-bar-menu").querySelector(".menu-bar-item").click();
    undoItem.click();
    expect(ctx.docStore.undo).toBeDefined();
    const dropdown = undoItem.closest(".menu-dropdown");
    expect(dropdown.hidden).toBe(true);
  });

  it("jff.import menu item prompts for a path and imports it", async () => {
    const { container, ctx } = await setup();
    const importItem = container.querySelector('[data-action="jff.import"]');
    importItem.closest(".menu-bar-menu").querySelector(".menu-bar-item").click();
    importItem.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.promptPath).toHaveBeenCalledWith("open-jff");
  });
});

describe("MenuBar disabled/gated state (edit.deleteSelection depends on ctx.selection)", () => {
  it("disables edit.deleteSelection with no selection and enables it once a state is selected", async () => {
    const { container, ctx } = await setup();
    const deleteItem = container.querySelector('[data-action="edit.deleteSelection"]');
    expect(deleteItem.disabled).toBe(true);

    ctx.setSelection({ kind: "state", id: 1 });
    expect(deleteItem.disabled).toBe(false);

    ctx.clearSelection();
    expect(deleteItem.disabled).toBe(true);
  });
});

describe("MenuBar multi-source contract (design D9, PR10)", () => {
  it("accepts an array of {title, sections} menus, each section carrying its own actions AND its own ctx", async () => {
    const faCtx = await setupCtx();
    const projectStore = new ProjectStore({
      projectNew: vi.fn(),
      projectManifest: vi.fn(),
      projectNewTab: vi.fn(),
      projectCloseTab: vi.fn(),
      projectRenameTab: vi.fn(),
      projectOpen: vi.fn(),
      projectSave: vi.fn(),
    });
    const projectCtx = new ProjectContext(projectStore);
    const container = document.createElement("div");
    document.body.appendChild(container);

    new MenuBar(container, [...projectMenus(projectCtx), ...faMenus(faCtx)]);

    // "Archivo" merges every section sharing that title — here just the
    // project "file"/"tabs" sections (Fa's own "interop" section is
    // exercised by the dedicated merge test below).
    expect(container.querySelector('[data-action="project.new"]')).not.toBeNull();
    expect(container.querySelector('[data-action="edit.undo"]')).not.toBeNull();
  });

  it("merges multiple menu entries that share the same title into ONE top-level trigger+dropdown (design D9: Archivo = Fa's interop + project's file/tabs)", async () => {
    const faCtx = await setupCtx();
    const projectStore = new ProjectStore({
      projectNew: vi.fn(),
      projectManifest: vi.fn(),
      projectNewTab: vi.fn(),
      projectCloseTab: vi.fn(),
      projectRenameTab: vi.fn(),
      projectOpen: vi.fn(),
      projectSave: vi.fn(),
    });
    const projectCtx = new ProjectContext(projectStore);
    const container = document.createElement("div");
    document.body.appendChild(container);

    const interopSection = {
      title: "Archivo",
      sections: [{ id: "interop", actions: actions.filter((a) => a.group === "interop"), ctx: faCtx }],
    };
    new MenuBar(container, [interopSection, ...projectMenus(projectCtx)]);

    const archivoTriggers = [...container.querySelectorAll(".menu-bar-item")].filter(
      (b) => b.textContent === "Archivo",
    );
    expect(archivoTriggers.length).toBe(1);
    expect(container.querySelector('[data-action="jff.import"]')).not.toBeNull();
    expect(container.querySelector('[data-action="project.new"]')).not.toBeNull();
  });

  it("hidden, not disabled: a menus array that omits Convertir/Test entirely (as a non-FA composer would build) renders no trigger and no items for them at all", async () => {
    const faCtx = await setupCtx();
    const container = document.createElement("div");
    document.body.appendChild(container);

    // Only "Editar" — as if composed for a kind with no convert/test groups.
    new MenuBar(container, [
      { title: "Editar", sections: [{ id: "edit", actions: actions.filter((a) => a.group === "edit"), ctx: faCtx }] },
    ]);

    const triggers = [...container.querySelectorAll(".menu-bar-item")].map((b) => b.textContent);
    expect(triggers).toEqual(["Editar"]);
    expect(container.querySelector('[data-action="convert.toDfa"]')).toBeNull();
    expect(container.querySelector('[data-action="test.singleTrace"]')).toBeNull();
    // Not merely disabled-and-hidden-by-CSS: the elements don't exist at all.
    expect(container.querySelectorAll(".menu-dropdown-item").length).toBe(
      actions.filter((a) => a.group === "edit").length,
    );
  });

  it("re-renders (enables/disables) when EITHER section's own ctx notifies, independently", async () => {
    const faCtx = await setupCtx();
    const projectStore = new ProjectStore({
      projectNew: vi.fn(),
      projectManifest: vi.fn(),
      projectNewTab: vi.fn(),
      projectCloseTab: vi.fn(),
      projectRenameTab: vi.fn(),
      projectOpen: vi.fn(),
      projectSave: vi.fn(),
    });
    const projectCtx = new ProjectContext(projectStore);
    const container = document.createElement("div");
    document.body.appendChild(container);

    new MenuBar(container, [...faMenus(faCtx), ...projectMenus(projectCtx)]);

    const deleteItem = container.querySelector('[data-action="edit.deleteSelection"]');
    expect(deleteItem.disabled).toBe(true);
    faCtx.setSelection({ kind: "state", id: 1 });
    expect(deleteItem.disabled).toBe(false);

    const closeTabItem = container.querySelector('[data-action="project.closeTab"]');
    expect(closeTabItem.disabled).toBe(true);
    projectStore.tabs.push({ id: 0, kind: "Fa", name: "A", revision: 0 });
    projectStore._notify();
    expect(closeTabItem.disabled).toBe(false);
  });

  it("a submenu action (Recientes) renders as a trigger whose items are recomputed from ctx on open, without a static `run`", async () => {
    const projectStore = new ProjectStore({
      projectNew: vi.fn(),
      projectManifest: vi.fn(),
      projectNewTab: vi.fn(),
      projectCloseTab: vi.fn(),
      projectRenameTab: vi.fn(),
      projectOpen: vi.fn(),
      projectSave: vi.fn(),
    });
    const openPath = vi.fn().mockResolvedValue(undefined);
    projectStore.open = openPath;
    const recentProjects = { list: () => ["/a.jflapproj", "/b.jflapproj"], add: vi.fn() };
    const projectCtx = new ProjectContext(projectStore, { recentProjects });
    const container = document.createElement("div");
    document.body.appendChild(container);

    new MenuBar(container, projectMenus(projectCtx));

    const recentTrigger = container.querySelector('[data-action="project.recent"]');
    expect(recentTrigger).not.toBeNull();
    recentTrigger.click();

    const subItems = container.querySelectorAll(".menu-submenu-item");
    expect([...subItems].map((i) => i.textContent)).toEqual(["/a.jflapproj", "/b.jflapproj"]);

    subItems[0].click();
    expect(openPath).toHaveBeenCalledWith("/a.jflapproj");
  });
});
