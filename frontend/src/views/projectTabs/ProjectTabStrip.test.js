import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectTabStrip } from "./ProjectTabStrip.js";
import { ProjectStore } from "../../project/ProjectStore.js";

function fakeClient(overrides = {}) {
  return {
    projectNew: vi.fn(),
    projectManifest: vi.fn(),
    projectNewTab: vi.fn(),
    projectCloseTab: vi.fn(),
    projectRenameTab: vi.fn(),
    projectReorderTab: vi.fn(),
    projectOpen: vi.fn(),
    projectSave: vi.fn(),
    ...overrides,
  };
}

const twoTabManifest = {
  tabs: [
    { id: 0, kind: "Fa", name: "Autómata 1", revision: 0 },
    { id: 1, kind: "Mealy", name: "Mealy 1", revision: 0 },
  ],
  revision: 0,
};

async function setup(hooks = {}, clientOverrides = {}) {
  const client = fakeClient({ projectNew: vi.fn().mockResolvedValue(twoTabManifest), ...clientOverrides });
  const projectStore = new ProjectStore(client);
  await projectStore.newProject();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const strip = new ProjectTabStrip(container, projectStore, hooks);
  return { client, projectStore, container, strip };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("ProjectTabStrip rendering (design D7)", () => {
  it("renders one .project-tab per tab, in ProjectStore order", async () => {
    const { container } = await setup();
    const tabs = container.querySelectorAll(".project-tab");
    expect(tabs.length).toBe(2);
    expect([...tabs].map((t) => t.dataset.tabId)).toEqual(["0", "1"]);
  });

  it("shows each tab's own name", async () => {
    const { container } = await setup();
    const tabs = container.querySelectorAll(".project-tab");
    expect(tabs[0].querySelector(".project-tab-name").textContent).toBe("Autómata 1");
    expect(tabs[1].querySelector(".project-tab-name").textContent).toBe("Mealy 1");
  });

  it("shows a kind-badge matching each tab's MachineKind label", async () => {
    const { container } = await setup();
    const tabs = container.querySelectorAll(".project-tab");
    expect(tabs[0].querySelector(".project-tab-kind-badge").textContent).toBe("Autómata Finito");
    expect(tabs[1].querySelector(".project-tab-kind-badge").textContent).toBe("Máquina de Mealy");
  });

  it("marks the current activeTabId with an 'active' class", async () => {
    const { container, projectStore } = await setup();
    const tabs = container.querySelectorAll(".project-tab");
    expect(tabs[0].classList.contains("active")).toBe(true);
    expect(tabs[1].classList.contains("active")).toBe(false);

    projectStore.setActiveTab(1);

    expect(container.querySelector('[data-tab-id="0"]').classList.contains("active")).toBe(false);
    expect(container.querySelector('[data-tab-id="1"]').classList.contains("active")).toBe(true);
  });

  it("re-renders live when the store's manifest changes (subscribe wiring)", async () => {
    const afterClose = { tabs: [{ id: 1, kind: "Mealy", name: "Mealy 1", revision: 0 }], revision: 0 };
    const { container, projectStore } = await setup({}, { projectCloseTab: vi.fn().mockResolvedValue(afterClose) });

    await projectStore.closeTab(0);

    expect(container.querySelectorAll(".project-tab").length).toBe(1);
    expect(container.querySelector(".project-tab-name").textContent).toBe("Mealy 1");
  });
});

describe("ProjectTabStrip dirty-dot (per-tab, ProjectStore.isTabDirty)", () => {
  it("shows a dirty-dot only for the edited tab, not its clean sibling", async () => {
    const { container, projectStore } = await setup();
    expect(container.querySelectorAll(".project-tab-dirty-dot").length).toBe(0);

    projectStore.updateTabRevision(0, 1);

    const tabs = container.querySelectorAll(".project-tab");
    expect(tabs[0].querySelector(".project-tab-dirty-dot")).not.toBeNull();
    expect(tabs[1].querySelector(".project-tab-dirty-dot")).toBeNull();
  });
});

describe("ProjectTabStrip add/close (delegates to ProjectStore, owns no IPC of its own)", () => {
  it("addTab(kind, name) delegates to projectStore.newTab", async () => {
    const { strip, client } = await setup(
      {},
      {
        projectNewTab: vi.fn().mockResolvedValue({
          tabs: [...twoTabManifest.tabs, { id: 2, kind: "Pda", name: "Pda 1", revision: 0 }],
          revision: 0,
        }),
      },
    );

    await strip.addTab("Pda", "Pda 1");

    expect(client.projectNewTab).toHaveBeenCalledWith("Pda", "Pda 1");
  });

  it("clicking a tab's close button delegates to projectStore.closeTab with that tab's id", async () => {
    const { container, client } = await setup(
      {},
      { projectCloseTab: vi.fn().mockResolvedValue({ tabs: [], revision: 0 }) },
    );
    const closeButton = container.querySelector('[data-tab-id="0"] .project-tab-close');

    closeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    expect(client.projectCloseTab).toHaveBeenCalledWith(0);
  });

  it("closing a tab does not also activate it (close click never bubbles into the activate click)", async () => {
    const onActivate = vi.fn();
    const { container } = await setup(
      { onActivate },
      { projectCloseTab: vi.fn().mockResolvedValue({ tabs: [{ id: 0, kind: "Fa", name: "Autómata 1", revision: 0 }], revision: 0 }) },
    );
    onActivate.mockClear();
    const closeButton = container.querySelector('[data-tab-id="1"] .project-tab-close');

    closeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    expect(onActivate).not.toHaveBeenCalledWith(1);
  });
});

describe("ProjectTabStrip activation callbacks (D11: strip never mounts/unmounts panes itself)", () => {
  it("clicking a tab sets it active on the store and fires onActivate/onDeactivate", async () => {
    const onActivate = vi.fn();
    const onDeactivate = vi.fn();
    const { container, projectStore } = await setup({ onActivate, onDeactivate });
    onActivate.mockClear();
    onDeactivate.mockClear();

    container.querySelector('[data-tab-id="1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(projectStore.activeTabId).toBe(1);
    expect(onDeactivate).toHaveBeenCalledWith(0);
    expect(onActivate).toHaveBeenCalledWith(1);
  });
});

describe("ProjectTabStrip overflow (many tabs never squash — scroll + nav buttons + gestures)", () => {
  it("keeps tab buttons inside their own scrollable sub-element, separate from the nav buttons", async () => {
    const { container } = await setup();
    const scrollArea = container.querySelector(".project-tab-strip-scroll");
    expect(scrollArea).not.toBeNull();
    expect(scrollArea.querySelectorAll(".project-tab").length).toBe(2);
    expect(container.querySelectorAll(".project-tab-strip-nav-btn").length).toBe(2);
    // The nav buttons are NOT inside the scrollable area — they stay
    // docked at the strip's right edge regardless of scroll position.
    expect(scrollArea.querySelectorAll(".project-tab-strip-nav-btn").length).toBe(0);
  });

  it("clicking the right nav button scrolls the tab list right", async () => {
    const { container } = await setup();
    const scrollArea = container.querySelector(".project-tab-strip-scroll");
    scrollArea.scrollLeft = 0;
    const [, rightButton] = container.querySelectorAll(".project-tab-strip-nav-btn");

    rightButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(scrollArea.scrollLeft).toBeGreaterThan(0);
  });

  it("clicking the left nav button scrolls the tab list left", async () => {
    const { container } = await setup();
    const scrollArea = container.querySelector(".project-tab-strip-scroll");
    scrollArea.scrollLeft = 200;
    const [leftButton] = container.querySelectorAll(".project-tab-strip-nav-btn");

    leftButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(scrollArea.scrollLeft).toBeLessThan(200);
  });

  it("a plain vertical wheel scroll (deltaY, no deltaX) pans the strip horizontally", async () => {
    const { container } = await setup();
    const scrollArea = container.querySelector(".project-tab-strip-scroll");
    scrollArea.scrollLeft = 0;

    scrollArea.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, deltaX: 0, bubbles: true, cancelable: true }));

    expect(scrollArea.scrollLeft).toBe(100);
  });

  it("leaves a real horizontal wheel/trackpad gesture (deltaX != 0) to the browser's native scroll", async () => {
    const { container } = await setup();
    const scrollArea = container.querySelector(".project-tab-strip-scroll");
    scrollArea.scrollLeft = 0;
    const event = new WheelEvent("wheel", { deltaY: 0, deltaX: 50, bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(event, "preventDefault");

    scrollArea.dispatchEvent(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(scrollArea.scrollLeft).toBe(0);
  });

  it("dragging the mouse past the threshold pans the strip and suppresses the very next click", async () => {
    const onActivate = vi.fn();
    const { container, projectStore } = await setup({ onActivate });
    const scrollArea = container.querySelector(".project-tab-strip-scroll");
    scrollArea.scrollLeft = 0;
    onActivate.mockClear();

    scrollArea.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 100 }));
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 60 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    expect(scrollArea.scrollLeft).toBe(40);

    const tab1 = container.querySelector('[data-tab-id="1"]');
    tab1.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(projectStore.activeTabId).toBe(0);
    expect(onActivate).not.toHaveBeenCalledWith(1);

    // The suppression is one-shot: a following, undragged click works normally.
    tab1.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(projectStore.activeTabId).toBe(1);
  });

  it("a plain click (mousedown/mouseup with no real movement) is never treated as a drag", async () => {
    const onActivate = vi.fn();
    const { container, projectStore } = await setup({ onActivate });
    const scrollArea = container.querySelector(".project-tab-strip-scroll");
    onActivate.mockClear();

    scrollArea.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 100 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    const tab1 = container.querySelector('[data-tab-id="1"]');
    tab1.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(projectStore.activeTabId).toBe(1);
    expect(onActivate).toHaveBeenCalledWith(1);
  });
});

describe("ProjectTabStrip drag-to-reorder (click-and-hold a tab, move left/right)", () => {
  /** Stubs every current `.project-tab`'s `getBoundingClientRect` to sit
   * side-by-side at 100px each, in current DOM order — jsdom never lays
   * out real geometry, so the drop-index math (`_dropIndexFor`) needs
   * fake-but-consistent rects to work against, same technique commonly
   * used for jsdom drag-and-drop tests. */
  function stubTabRects(container) {
    const tabs = [...container.querySelectorAll(".project-tab")];
    tabs.forEach((tab, i) => {
      tab.getBoundingClientRect = () => ({ left: i * 100, width: 100, right: i * 100 + 100 });
    });
  }

  it("dragging a tab past its right sibling's midpoint reorders it there on mouseup", async () => {
    const threeTabManifest = {
      tabs: [
        { id: 0, kind: "Fa", name: "A", revision: 0 },
        { id: 1, kind: "Mealy", name: "B", revision: 0 },
        { id: 2, kind: "Moore", name: "C", revision: 0 },
      ],
      revision: 0,
    };
    const { container, client } = await setup(
      {},
      {
        projectNew: vi.fn().mockResolvedValue(threeTabManifest),
        projectReorderTab: vi.fn().mockResolvedValue({
          tabs: [threeTabManifest.tabs[1], threeTabManifest.tabs[0], threeTabManifest.tabs[2]],
          revision: 0,
        }),
      },
    );
    stubTabRects(container);
    const tabA = container.querySelector('[data-tab-id="0"]');

    tabA.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 50 }));
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 170 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 170 }));

    // Past tab B's midpoint (100-200) but before tab C's (200-300) — B's
    // own slot, index 1 once A is excluded from the sibling list.
    expect(client.projectReorderTab).toHaveBeenCalledWith(0, 1);
  });

  it("dragging back over its own original slot is a no-op past the threshold check (never calls reorderTab)", async () => {
    const { container, client } = await setup();
    stubTabRects(container);
    const tabA = container.querySelector('[data-tab-id="0"]');

    tabA.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 50 }));
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 52 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 52 }));

    expect(client.projectReorderTab).not.toHaveBeenCalled();
  });

  it("suppresses the click that follows a real drag on the DRAGGED tab itself, without suppressing a later plain click", async () => {
    // A dragged tab keeps following the pointer via its own `transform`
    // (`.reordering`'s `z-index: 3` keeps it on top), so in a real browser
    // the eventual mouseup — and the click it generates — still targets
    // the dragged button itself, not whichever sibling it now visually
    // overlaps. `tabB` (not yet active) is the one dragged here, so an
    // un-suppressed click would incorrectly also activate it as a side
    // effect of merely having been reordered.
    const onActivate = vi.fn();
    const { container, projectStore } = await setup(
      { onActivate },
      { projectReorderTab: vi.fn().mockResolvedValue(twoTabManifest) },
    );
    stubTabRects(container);
    onActivate.mockClear();
    const tabB = container.querySelector('[data-tab-id="1"]');

    tabB.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 150 }));
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 30 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 30 }));

    tabB.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(projectStore.activeTabId).toBe(0);

    tabB.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(projectStore.activeTabId).toBe(1);
  });

  it("never starts a reorder-drag from the close button (its own click still closes the tab normally)", async () => {
    const { container, client } = await setup(
      {},
      { projectCloseTab: vi.fn().mockResolvedValue({ tabs: [twoTabManifest.tabs[1]], revision: 0 }) },
    );
    stubTabRects(container);
    const closeButton = container.querySelector('[data-tab-id="0"] .project-tab-close');

    closeButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 50 }));
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 170 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 170 }));
    expect(client.projectReorderTab).not.toHaveBeenCalled();

    closeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(client.projectCloseTab).toHaveBeenCalledWith(0);
  });

  it("a real drag past the threshold adds/removes the 'reordering' class on the dragged tab", async () => {
    const { container } = await setup({}, { projectReorderTab: vi.fn().mockResolvedValue(twoTabManifest) });
    stubTabRects(container);
    const tabA = container.querySelector('[data-tab-id="0"]');

    tabA.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 50 }));
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 170 }));
    expect(tabA.classList.contains("reordering")).toBe(true);

    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 170 }));
    expect(tabA.classList.contains("reordering")).toBe(false);
  });
});

describe("ProjectTabStrip rename (dblclick to edit; mirrors backend project_rename_tab rejection)", () => {
  it("dblclick opens a rename input pre-filled with the current name", async () => {
    const { container } = await setup();
    container.querySelector('[data-tab-id="0"]').dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    const input = container.querySelector(".project-tab-rename-input");
    expect(input).not.toBeNull();
    expect(input.value).toBe("Autómata 1");
  });

  it("committing a valid new name calls projectStore.renameTab", async () => {
    const { container, client } = await setup(
      {},
      { projectRenameTab: vi.fn().mockResolvedValue({ tabs: [{ id: 0, kind: "Fa", name: "Renamed", revision: 0 }, twoTabManifest.tabs[1]], revision: 0 }) },
    );
    container.querySelector('[data-tab-id="0"]').dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = container.querySelector(".project-tab-rename-input");
    input.value = "Renamed";
    input.dispatchEvent(new Event("blur"));
    await Promise.resolve();
    await Promise.resolve();

    expect(client.projectRenameTab).toHaveBeenCalledWith(0, "Renamed");
  });

  it("an empty name silently reverts — no renameTab call, no throw, no alert-like notice element", async () => {
    const { container, client } = await setup();
    container.querySelector('[data-tab-id="0"]').dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = container.querySelector(".project-tab-rename-input");
    input.value = "   ";

    expect(() => input.dispatchEvent(new Event("blur"))).not.toThrow();
    await Promise.resolve();

    expect(client.projectRenameTab).not.toHaveBeenCalled();
    expect(container.querySelector('[data-tab-id="0"] .project-tab-name').textContent).toBe("Autómata 1");
    expect(document.querySelector(".notice")).toBeNull();
  });

  it("a duplicate name (matching a sibling tab) silently reverts — no renameTab call", async () => {
    const { container, client } = await setup();
    container.querySelector('[data-tab-id="0"]').dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = container.querySelector(".project-tab-rename-input");
    input.value = "Mealy 1";

    expect(() => input.dispatchEvent(new Event("blur"))).not.toThrow();
    await Promise.resolve();

    expect(client.projectRenameTab).not.toHaveBeenCalled();
    expect(container.querySelector('[data-tab-id="0"] .project-tab-name').textContent).toBe("Autómata 1");
  });

  it("Escape cancels the rename in place, reverting without committing", async () => {
    const { container, client } = await setup();
    container.querySelector('[data-tab-id="0"]').dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = container.querySelector(".project-tab-rename-input");
    input.value = "Whatever";

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(client.projectRenameTab).not.toHaveBeenCalled();
    expect(container.querySelector('[data-tab-id="0"] .project-tab-name').textContent).toBe("Autómata 1");
  });
});
