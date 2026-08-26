import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountFaTab } from "./mountFaTab.js";

function emptySnapshot(revision = 0) {
  return { revision, states: [], edges: [], derived: { classification: "Dfa", alphabet: [], unreachable: [] } };
}

function fakeClient(overrides = {}) {
  return {
    docSnapshot: vi.fn().mockResolvedValue(emptySnapshot()),
    docApply: vi.fn(),
    docUndo: vi.fn(),
    docRedo: vi.fn(),
    docOpen: vi.fn(),
    docSave: vi.fn(),
    simTrace: vi.fn(),
    simBatch: vi.fn(),
    jffImport: vi.fn(),
    jffExport: vi.fn(),
    convToRegex: vi.fn(),
    convFromRegex: vi.fn(),
    convToGrammar: vi.fn(),
    convFromGrammar: vi.fn(),
    convNfaToDfa: vi.fn(),
    convMinimizeDfa: vi.fn(),
    ...overrides,
  };
}

function fakeHosts() {
  return { contentHost: document.createElement("div"), toolbarHost: document.createElement("div") };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("mountFaTab (design D11)", () => {
  it("mounts a hidden .app-body into contentHost and a hidden .toolbar into toolbarHost", async () => {
    const hosts = fakeHosts();
    const mount = mountFaTab(0, hosts, fakeClient());
    await Promise.resolve();

    expect(hosts.contentHost.contains(mount.root)).toBe(true);
    expect(hosts.toolbarHost.contains(mount.toolbarRoot)).toBe(true);
    expect(mount.root.hidden).toBe(true);
    expect(mount.toolbarRoot.hidden).toBe(true);
  });

  it("activate() un-hides root/toolbar AND re-triggers viewport.fitToWindow() (a hidden container measures 0x0)", async () => {
    const hosts = fakeHosts();
    const mount = mountFaTab(0, hosts, fakeClient());
    await Promise.resolve();
    const fitToWindow = vi.fn();
    mount.ctx.viewport.fitToWindow = fitToWindow;

    mount.activate();

    expect(mount.root.hidden).toBe(false);
    expect(mount.toolbarRoot.hidden).toBe(false);
    expect(fitToWindow).toHaveBeenCalledTimes(1);
  });

  it("deactivate() re-hides root/toolbar", async () => {
    const hosts = fakeHosts();
    const mount = mountFaTab(0, hosts, fakeClient());
    await Promise.resolve();
    mount.activate();

    mount.deactivate();

    expect(mount.root.hidden).toBe(true);
    expect(mount.toolbarRoot.hidden).toBe(true);
  });
});

describe("mountFaTab .jff import cutover (design D12)", () => {
  function fakeProjectStoreAndTabHost(newTabId) {
    const newlyMountedDocStore = { loadSnapshot: vi.fn(), setFilePath: vi.fn() };
    const projectStore = {
      tabs: [{ id: 0, kind: "Fa", name: "Autómata Finito 1", revision: 0 }],
      newTab: vi.fn(async (kind, name) => {
        projectStore.tabs.push({ id: newTabId, kind, name, revision: 0 });
      }),
      closeTab: vi.fn(async (tabId) => {
        projectStore.tabs = projectStore.tabs.filter((t) => t.id !== tabId);
      }),
      setActiveTab: vi.fn(),
    };
    const tabHost = { getMount: vi.fn(() => ({ docStore: newlyMountedDocStore })) };
    return { projectStore, tabHost, newlyMountedDocStore };
  }

  it("creates a brand-new Fa tab, imports into it, and activates it — never touching the calling tab's own docStore", async () => {
    const hosts = fakeHosts();
    const { projectStore, tabHost, newlyMountedDocStore } = fakeProjectStoreAndTabHost(1);
    const client = fakeClient({
      jffImport: vi.fn().mockResolvedValue({ snapshot: emptySnapshot(1), report: { items: [] } }),
    });
    const mount = mountFaTab(0, hosts, client, { projectStore, tabHost });
    await Promise.resolve();

    await mount.ctx.importJff("/path/to/example.jff");

    expect(projectStore.newTab).toHaveBeenCalledWith("Fa", "example");
    expect(client.jffImport).toHaveBeenCalledWith("/path/to/example.jff", 1);
    expect(newlyMountedDocStore.loadSnapshot).toHaveBeenCalled();
    expect(newlyMountedDocStore.setFilePath).toHaveBeenCalledWith("/path/to/example.jff");
    expect(projectStore.setActiveTab).toHaveBeenCalledWith(1);
    expect(projectStore.closeTab).not.toHaveBeenCalled();
  });

  it("closes the freshly created tab again when the import itself fails, instead of leaving an empty/broken tab behind", async () => {
    const hosts = fakeHosts();
    const { projectStore, tabHost } = fakeProjectStoreAndTabHost(1);
    const client = fakeClient({ jffImport: vi.fn().mockRejectedValue(new Error("bad file")) });
    const mount = mountFaTab(0, hosts, client, { projectStore, tabHost });
    await Promise.resolve();

    await mount.ctx.importJff("/path/to/broken.jff");

    expect(projectStore.newTab).toHaveBeenCalledWith("Fa", "broken");
    expect(projectStore.closeTab).toHaveBeenCalledWith(1);
    expect(projectStore.setActiveTab).not.toHaveBeenCalled();
  });
});
