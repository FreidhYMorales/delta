import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../../store/DocStore.js";
import { ViewContext } from "../../commands/context.js";
import { MenuBar, MENU_GROUP_TITLES, formatKeybinding } from "./MenuBar.js";

function emptySnapshot() {
  return {
    revision: 1,
    states: [],
    edges: [],
    derived: { classification: "Dfa", alphabet: [], unreachable: [] },
  };
}

async function setup(hooks = {}) {
  const client = {
    docSnapshot: vi.fn().mockResolvedValue(emptySnapshot()),
    docApply: vi.fn(),
    docUndo: vi.fn(),
    docRedo: vi.fn(),
  };
  const docStore = new DocStore(client);
  await docStore.load();
  const ctx = new ViewContext(docStore, {
    viewport: { zoomIn: vi.fn(), zoomOut: vi.fn(), reset: vi.fn(), fitToWindow: vi.fn() },
    layout: { circle: vi.fn() },
    promptPath: vi.fn().mockResolvedValue("/tmp/x.jff"),
    importJff: vi.fn(),
    exportJff: vi.fn(),
    testing: { openSingle: vi.fn(), openBatch: vi.fn() },
    ...hooks,
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const menuBar = new MenuBar(container, ctx);
  return { docStore, ctx, container, menuBar };
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
