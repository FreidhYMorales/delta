import { describe, expect, it, vi } from "vitest";
import { ProjectStore } from "./ProjectStore.js";

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

const manifestA = {
  tabs: [{ id: 0, kind: "Fa", name: "A", revision: 0 }],
  revision: 0,
};

describe("ProjectStore dirty-flag math (design D10)", () => {
  it("is clean immediately after newProject()", async () => {
    const client = fakeClient({ projectNew: vi.fn().mockResolvedValue(manifestA) });
    const store = new ProjectStore(client);

    await store.newProject();

    expect(store.isDirty).toBe(false);
  });

  it("is clean immediately after open()", async () => {
    const client = fakeClient({ projectOpen: vi.fn().mockResolvedValue(manifestA) });
    const store = new ProjectStore(client);

    await store.open("/p.jflapproj");

    expect(store.isDirty).toBe(false);
  });

  it("is clean immediately after newTab()", async () => {
    const client = fakeClient({
      projectNew: vi.fn().mockResolvedValue(manifestA),
      projectNewTab: vi.fn().mockResolvedValue({
        tabs: [...manifestA.tabs, { id: 1, kind: "Mealy", name: "B", revision: 0 }],
        revision: 0,
      }),
    });
    const store = new ProjectStore(client);
    await store.newProject();

    await store.newTab("Mealy", "B");

    expect(store.isDirty).toBe(false);
  });

  it("becomes dirty after a tab's own document is edited (revision moves past savedRevision)", async () => {
    const client = fakeClient({ projectNew: vi.fn().mockResolvedValue(manifestA) });
    const store = new ProjectStore(client);
    await store.newProject();

    store.updateTabRevision(0, 1);

    expect(store.isDirty).toBe(true);
  });

  it("is clean again immediately after save() updates savedRevision to the live aggregate", async () => {
    const client = fakeClient({
      projectNew: vi.fn().mockResolvedValue(manifestA),
      projectSave: vi.fn().mockResolvedValue({ tabs: [{ id: 0, kind: "Fa", name: "A", revision: 1 }], revision: 1 }),
    });
    const store = new ProjectStore(client);
    await store.newProject();
    store.updateTabRevision(0, 1);
    expect(store.isDirty).toBe(true);

    await store.save("/p.jflapproj");

    expect(store.isDirty).toBe(false);
  });

  it("does not require any extra IPC call to compute dirty — it's pure local math", async () => {
    const client = fakeClient({ projectNew: vi.fn().mockResolvedValue(manifestA) });
    const store = new ProjectStore(client);
    await store.newProject();

    store.updateTabRevision(0, 5);
    void store.isDirty;
    void store.isDirty;

    expect(client.projectManifest).not.toHaveBeenCalled();
  });
});

describe("ProjectStore.filePath (backs project.save's overwrite-vs-prompt decision)", () => {
  it("is null for a brand-new project that was never opened or saved", async () => {
    const client = fakeClient({ projectNew: vi.fn().mockResolvedValue(manifestA) });
    const store = new ProjectStore(client);

    await store.newProject();

    expect(store.filePath).toBeNull();
  });

  it("is set to the path a project was opened from", async () => {
    const client = fakeClient({ projectOpen: vi.fn().mockResolvedValue(manifestA) });
    const store = new ProjectStore(client);

    await store.open("/opened.jflapproj");

    expect(store.filePath).toBe("/opened.jflapproj");
  });

  it("is set to the path a project was saved to", async () => {
    const client = fakeClient({
      projectNew: vi.fn().mockResolvedValue(manifestA),
      projectSave: vi.fn().mockResolvedValue(manifestA),
    });
    const store = new ProjectStore(client);
    await store.newProject();

    await store.save("/saved.jflapproj");

    expect(store.filePath).toBe("/saved.jflapproj");
  });

  it("resets to null when newProject() starts a fresh project", async () => {
    const client = fakeClient({
      projectOpen: vi.fn().mockResolvedValue(manifestA),
      projectNew: vi.fn().mockResolvedValue({ tabs: [], revision: 0 }),
    });
    const store = new ProjectStore(client);
    await store.open("/opened.jflapproj");
    expect(store.filePath).toBe("/opened.jflapproj");

    await store.newProject();

    expect(store.filePath).toBeNull();
  });
});

describe("ProjectStore per-tab dirty tracking (PR10: ProjectTabStrip's dirty-dot)", () => {
  it("no tab is dirty immediately after newProject()", async () => {
    const client = fakeClient({
      projectNew: vi.fn().mockResolvedValue({
        tabs: [
          { id: 0, kind: "Fa", name: "A", revision: 0 },
          { id: 1, kind: "Mealy", name: "B", revision: 0 },
        ],
        revision: 0,
      }),
    });
    const store = new ProjectStore(client);

    await store.newProject();

    expect(store.isTabDirty(0)).toBe(false);
    expect(store.isTabDirty(1)).toBe(false);
  });

  it("marks only the edited tab dirty, leaving sibling tabs clean", async () => {
    const client = fakeClient({
      projectNew: vi.fn().mockResolvedValue({
        tabs: [
          { id: 0, kind: "Fa", name: "A", revision: 0 },
          { id: 1, kind: "Mealy", name: "B", revision: 0 },
        ],
        revision: 0,
      }),
    });
    const store = new ProjectStore(client);
    await store.newProject();

    store.updateTabRevision(0, 1);

    expect(store.isTabDirty(0)).toBe(true);
    expect(store.isTabDirty(1)).toBe(false);
  });

  it("is clean again for that tab once save() re-baselines every tab's revision", async () => {
    const client = fakeClient({
      projectNew: vi.fn().mockResolvedValue(manifestA),
      projectSave: vi.fn().mockResolvedValue({ tabs: [{ id: 0, kind: "Fa", name: "A", revision: 3 }], revision: 3 }),
    });
    const store = new ProjectStore(client);
    await store.newProject();
    store.updateTabRevision(0, 3);
    expect(store.isTabDirty(0)).toBe(true);

    await store.save("/p.jflapproj");

    expect(store.isTabDirty(0)).toBe(false);
  });

  it("returns false for an unknown tab id instead of throwing", async () => {
    const client = fakeClient({ projectNew: vi.fn().mockResolvedValue(manifestA) });
    const store = new ProjectStore(client);
    await store.newProject();

    expect(store.isTabDirty(999)).toBe(false);
  });
});

describe("ProjectStore tab list ordering", () => {
  it("reflects the manifest's tab order after newTab/closeTab/renameTab", async () => {
    const twoTabs = {
      tabs: [
        { id: 0, kind: "Fa", name: "A", revision: 0 },
        { id: 1, kind: "Mealy", name: "B", revision: 0 },
      ],
      revision: 0,
    };
    const client = fakeClient({
      projectNew: vi.fn().mockResolvedValue(manifestA),
      projectNewTab: vi.fn().mockResolvedValue(twoTabs),
    });
    const store = new ProjectStore(client);
    await store.newProject();

    await store.newTab("Mealy", "B");

    expect(store.tabs.map((t) => t.id)).toEqual([0, 1]);
    expect(store.tabs.map((t) => t.name)).toEqual(["A", "B"]);
  });

  it("reflects the manifest's new order after reorderTab()", async () => {
    const reordered = {
      tabs: [
        { id: 1, kind: "Mealy", name: "B", revision: 0 },
        { id: 0, kind: "Fa", name: "A", revision: 0 },
      ],
      revision: 0,
    };
    const client = fakeClient({
      projectNew: vi.fn().mockResolvedValue({
        tabs: [
          { id: 0, kind: "Fa", name: "A", revision: 0 },
          { id: 1, kind: "Mealy", name: "B", revision: 0 },
        ],
        revision: 0,
      }),
      projectReorderTab: vi.fn().mockResolvedValue(reordered),
    });
    const store = new ProjectStore(client);
    await store.newProject();

    await store.reorderTab(0, 1);

    expect(store.tabs.map((t) => t.id)).toEqual([1, 0]);
    expect(client.projectReorderTab).toHaveBeenCalledWith(0, 1);
  });

  it("removes a tab from the list after closeTab()", async () => {
    const afterClose = { tabs: [{ id: 1, kind: "Mealy", name: "B", revision: 0 }], revision: 0 };
    const client = fakeClient({
      projectNew: vi.fn().mockResolvedValue({
        tabs: [
          { id: 0, kind: "Fa", name: "A", revision: 0 },
          { id: 1, kind: "Mealy", name: "B", revision: 0 },
        ],
        revision: 0,
      }),
      projectCloseTab: vi.fn().mockResolvedValue(afterClose),
    });
    const store = new ProjectStore(client);
    await store.newProject();

    await store.closeTab(0);

    expect(store.tabs.map((t) => t.id)).toEqual([1]);
    expect(client.projectCloseTab).toHaveBeenCalledWith(0);
  });

  it("renames a tab in place, preserving position, after renameTab()", async () => {
    const renamed = { tabs: [{ id: 0, kind: "Fa", name: "Renamed", revision: 0 }], revision: 0 };
    const client = fakeClient({
      projectNew: vi.fn().mockResolvedValue(manifestA),
      projectRenameTab: vi.fn().mockResolvedValue(renamed),
    });
    const store = new ProjectStore(client);
    await store.newProject();

    await store.renameTab(0, "Renamed");

    expect(store.tabs[0].name).toBe("Renamed");
    expect(client.projectRenameTab).toHaveBeenCalledWith(0, "Renamed");
  });

  it("notifies subscribers on every manifest-changing call", async () => {
    const client = fakeClient({ projectNew: vi.fn().mockResolvedValue(manifestA) });
    const store = new ProjectStore(client);
    const listener = vi.fn();
    store.subscribe(listener);

    await store.newProject();

    expect(listener).toHaveBeenCalled();
  });
});
