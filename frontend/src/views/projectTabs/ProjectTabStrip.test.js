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
