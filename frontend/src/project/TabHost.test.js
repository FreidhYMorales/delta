import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectStore } from "./ProjectStore.js";

const mountFaTab = vi.fn();
const mountMealyTab = vi.fn();
const mountMooreTab = vi.fn();
const mountPdaTab = vi.fn();
const mountTmTab = vi.fn();

vi.mock("./tabs/mountFaTab.js", () => ({ mountFaTab: (...args) => mountFaTab(...args) }));
vi.mock("./tabs/mountMealyTab.js", () => ({ mountMealyTab: (...args) => mountMealyTab(...args) }));
vi.mock("./tabs/mountMooreTab.js", () => ({ mountMooreTab: (...args) => mountMooreTab(...args) }));
vi.mock("./tabs/mountPdaTab.js", () => ({ mountPdaTab: (...args) => mountPdaTab(...args) }));
vi.mock("./tabs/mountTmTab.js", () => ({ mountTmTab: (...args) => mountTmTab(...args) }));

const { TabHost } = await import("./TabHost.js");

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

function fakeMount(tabId) {
  return {
    tabId,
    root: document.createElement("div"),
    activate: vi.fn(),
    deactivate: vi.fn(),
    destroy: vi.fn(),
  };
}

beforeEach(() => {
  mountFaTab.mockReset();
  mountMealyTab.mockReset();
  mountMooreTab.mockReset();
  mountPdaTab.mockReset();
  mountTmTab.mockReset();
});

describe("TabHost mounting (design D11: mounting reacts to the tab LIST, not the active pointer)", () => {
  it("mounts one Fa tab through mountFaTab, passing its tabId/hosts/client", async () => {
    const client = fakeClient({
      projectNew: vi.fn().mockResolvedValue({ tabs: [{ id: 0, kind: "Fa", name: "A", revision: 0 }], revision: 0 }),
    });
    const projectStore = new ProjectStore(client);
    const mount0 = fakeMount(0);
    mountFaTab.mockReturnValue(mount0);
    const hosts = { contentHost: document.createElement("div"), toolbarHost: document.createElement("div") };

    await projectStore.newProject();
    const tabHost = new TabHost(hosts, client, projectStore);

    expect(mountFaTab).toHaveBeenCalledTimes(1);
    expect(mountFaTab).toHaveBeenCalledWith(0, hosts, client, expect.objectContaining({ projectStore }));
    expect(tabHost.getMount(0)).toBe(mount0);
  });

  it("dispatches by kind to the matching mountXTab factory", async () => {
    const client = fakeClient({
      projectNew: vi.fn().mockResolvedValue({
        tabs: [
          { id: 0, kind: "Fa", name: "A", revision: 0 },
          { id: 1, kind: "Mealy", name: "B", revision: 0 },
          { id: 2, kind: "Moore", name: "C", revision: 0 },
          { id: 3, kind: "Pda", name: "D", revision: 0 },
          { id: 4, kind: "Tm", name: "E", revision: 0 },
        ],
        revision: 0,
      }),
    });
    const projectStore = new ProjectStore(client);
    mountFaTab.mockReturnValue(fakeMount(0));
    mountMealyTab.mockReturnValue(fakeMount(1));
    mountMooreTab.mockReturnValue(fakeMount(2));
    mountPdaTab.mockReturnValue(fakeMount(3));
    mountTmTab.mockReturnValue(fakeMount(4));
    const hosts = { contentHost: document.createElement("div"), toolbarHost: document.createElement("div") };

    await projectStore.newProject();
    new TabHost(hosts, client, projectStore);

    expect(mountFaTab).toHaveBeenCalledTimes(1);
    expect(mountMealyTab).toHaveBeenCalledTimes(1);
    expect(mountMooreTab).toHaveBeenCalledTimes(1);
    expect(mountPdaTab).toHaveBeenCalledTimes(1);
    expect(mountTmTab).toHaveBeenCalledTimes(1);
  });

  it("mounts a newly created tab exactly once, without remounting already-mounted siblings", async () => {
    const client = fakeClient({
      projectNew: vi.fn().mockResolvedValue({ tabs: [{ id: 0, kind: "Fa", name: "A", revision: 0 }], revision: 0 }),
      projectNewTab: vi.fn().mockResolvedValue({
        tabs: [
          { id: 0, kind: "Fa", name: "A", revision: 0 },
          { id: 1, kind: "Mealy", name: "B", revision: 0 },
        ],
        revision: 0,
      }),
    });
    const projectStore = new ProjectStore(client);
    mountFaTab.mockReturnValue(fakeMount(0));
    mountMealyTab.mockReturnValue(fakeMount(1));
    const hosts = { contentHost: document.createElement("div"), toolbarHost: document.createElement("div") };

    await projectStore.newProject();
    new TabHost(hosts, client, projectStore);
    await projectStore.newTab("Mealy", "B");

    expect(mountFaTab).toHaveBeenCalledTimes(1);
    expect(mountMealyTab).toHaveBeenCalledTimes(1);
  });

  it("tears down a mount (calling destroy) once its tab is closed, and drops it from getMount", async () => {
    const client = fakeClient({
      projectNew: vi.fn().mockResolvedValue({
        tabs: [
          { id: 0, kind: "Fa", name: "A", revision: 0 },
          { id: 1, kind: "Mealy", name: "B", revision: 0 },
        ],
        revision: 0,
      }),
      projectCloseTab: vi.fn().mockResolvedValue({ tabs: [{ id: 1, kind: "Mealy", name: "B", revision: 0 }], revision: 0 }),
    });
    const projectStore = new ProjectStore(client);
    const mount0 = fakeMount(0);
    mountFaTab.mockReturnValue(mount0);
    mountMealyTab.mockReturnValue(fakeMount(1));
    const hosts = { contentHost: document.createElement("div"), toolbarHost: document.createElement("div") };

    await projectStore.newProject();
    const tabHost = new TabHost(hosts, client, projectStore);
    await projectStore.closeTab(0);

    expect(mount0.destroy).toHaveBeenCalledTimes(1);
    expect(tabHost.getMount(0)).toBeUndefined();
  });
});

describe("TabHost activation (delegates to the mount's own activate/deactivate)", () => {
  it("activate(tabId) calls that mount's activate()", async () => {
    const client = fakeClient({
      projectNew: vi.fn().mockResolvedValue({ tabs: [{ id: 0, kind: "Fa", name: "A", revision: 0 }], revision: 0 }),
    });
    const projectStore = new ProjectStore(client);
    const mount0 = fakeMount(0);
    mountFaTab.mockReturnValue(mount0);
    const hosts = { contentHost: document.createElement("div"), toolbarHost: document.createElement("div") };

    await projectStore.newProject();
    const tabHost = new TabHost(hosts, client, projectStore);
    tabHost.activate(0);

    expect(mount0.activate).toHaveBeenCalledTimes(1);
  });

  it("deactivate(tabId) calls that mount's deactivate()", async () => {
    const client = fakeClient({
      projectNew: vi.fn().mockResolvedValue({ tabs: [{ id: 0, kind: "Fa", name: "A", revision: 0 }], revision: 0 }),
    });
    const projectStore = new ProjectStore(client);
    const mount0 = fakeMount(0);
    mountFaTab.mockReturnValue(mount0);
    const hosts = { contentHost: document.createElement("div"), toolbarHost: document.createElement("div") };

    await projectStore.newProject();
    const tabHost = new TabHost(hosts, client, projectStore);
    tabHost.deactivate(0);

    expect(mount0.deactivate).toHaveBeenCalledTimes(1);
  });

  it("activate/deactivate on an unknown tabId is a no-op, not a throw", async () => {
    const client = fakeClient({ projectNew: vi.fn().mockResolvedValue({ tabs: [], revision: 0 }) });
    const projectStore = new ProjectStore(client);
    const hosts = { contentHost: document.createElement("div"), toolbarHost: document.createElement("div") };

    await projectStore.newProject();
    const tabHost = new TabHost(hosts, client, projectStore);

    expect(() => tabHost.activate(999)).not.toThrow();
    expect(() => tabHost.deactivate(999)).not.toThrow();
  });
});
