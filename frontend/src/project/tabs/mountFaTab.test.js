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

  it("activate() also focuses the diagram's SVG, so keyboard shortcuts work right after switching tabs", async () => {
    const hosts = fakeHosts();
    const mount = mountFaTab(0, hosts, fakeClient());
    await Promise.resolve();
    const svg = mount.root.querySelector("svg");
    const focus = vi.fn();
    svg.focus = focus;

    mount.activate();

    expect(focus).toHaveBeenCalledTimes(1);
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

describe("mountFaTab dirty-tracking (design D10: threads docStore.revision back to ProjectStore)", () => {
  it("calls projectStore.updateTabRevision(tabId, revision) whenever docStore notifies (e.g. after apply)", async () => {
    const hosts = fakeHosts();
    const updateTabRevision = vi.fn();
    const projectStore = { updateTabRevision };
    const client = fakeClient({
      docApply: vi.fn().mockResolvedValue({
        revision: 1,
        patches: [{ patch: "StateAdded", id: 0, label: "q0", x: 0, y: 0 }],
        derived: { classification: "Dfa", alphabet: [], unreachable: [] },
      }),
    });
    const mount = mountFaTab(5, hosts, client, { projectStore });
    await Promise.resolve();
    updateTabRevision.mockClear();

    await mount.docStore.apply([{ op: "AddState", label: "q0", x: 0, y: 0 }]);

    expect(updateTabRevision).toHaveBeenCalledWith(5, 1);
  });

  it("does not throw when no projectStore collaborator is given (e.g. a standalone/test mount)", async () => {
    const hosts = fakeHosts();
    expect(() => mountFaTab(0, hosts, fakeClient())).not.toThrow();
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

describe("mountFaTab ctx.promptSymbol Greek-letter conversion", () => {
  it("converts a typed Greek letter name to its symbol", async () => {
    const hosts = fakeHosts();
    const mount = mountFaTab(0, hosts, fakeClient());
    await Promise.resolve();

    const resultPromise = mount.ctx.promptSymbol();
    const input = document.querySelector(".prompt-modal-input");
    input.value = "delta";
    document.querySelector(".prompt-modal-ok").click();

    expect(await resultPromise).toBe("δ");
  });

  it("passes a cancelled prompt through as null", async () => {
    const hosts = fakeHosts();
    const mount = mountFaTab(0, hosts, fakeClient());
    await Promise.resolve();

    const resultPromise = mount.ctx.promptSymbol();
    document.querySelector(".prompt-modal-cancel").click();

    expect(await resultPromise).toBeNull();
  });

  it("treats typing the Greek name 'epsilon' the same as leaving the field blank (epsilon requested), not as a literal ε symbol", async () => {
    const hosts = fakeHosts();
    const mount = mountFaTab(0, hosts, fakeClient());
    await Promise.resolve();

    const resultPromise = mount.ctx.promptSymbol();
    const input = document.querySelector(".prompt-modal-input");
    input.value = "epsilon";
    document.querySelector(".prompt-modal-ok").click();

    expect(await resultPromise).toBe("");
  });

  it("treats typing the literal ε glyph the same as leaving the field blank (epsilon requested)", async () => {
    const hosts = fakeHosts();
    const mount = mountFaTab(0, hosts, fakeClient());
    await Promise.resolve();

    const resultPromise = mount.ctx.promptSymbol();
    const input = document.querySelector(".prompt-modal-input");
    input.value = "ε";
    document.querySelector(".prompt-modal-ok").click();

    expect(await resultPromise).toBe("");
  });

  it("submitting the field genuinely blank means 'epsilon requested' (\"\"), distinct from a cancelled prompt (null)", async () => {
    const hosts = fakeHosts();
    const mount = mountFaTab(0, hosts, fakeClient());
    await Promise.resolve();

    const resultPromise = mount.ctx.promptSymbol();
    document.querySelector(".prompt-modal-ok").click();

    expect(await resultPromise).toBe("");
  });
});

describe("mountFaTab ctx.layout.arrange (horizontal layered layout)", () => {
  it("arranges an acyclic automaton left-to-right by longest-path column, not the force-directed blob", async () => {
    const hosts = fakeHosts();
    const client = fakeClient({
      docSnapshot: vi.fn().mockResolvedValue({
        revision: 0,
        states: [
          { id: 0, label: "q0", x: 0, y: 0, initial: true, accepting: false },
          { id: 1, label: "q1", x: 0, y: 0, initial: false, accepting: false },
          { id: 2, label: "q2", x: 0, y: 0, initial: false, accepting: true },
        ],
        edges: [
          { from: 0, to: 1, epsilon: false, symbols: ["a"] },
          { from: 1, to: 2, epsilon: false, symbols: ["b"] },
        ],
        derived: { classification: "Dfa", alphabet: ["a", "b"], unreachable: [] },
      }),
      docApply: vi.fn().mockResolvedValue({ revision: 1, patches: [], derived: { alphabet: [], classification: "Dfa", unreachable: [] } }),
    });
    const mount = mountFaTab(0, hosts, client);
    await Promise.resolve();

    await mount.ctx.layout.arrange();

    const ops = client.docApply.mock.calls[0][0];
    const byId = new Map(ops.map((op) => [op.id, op]));
    expect(byId.get(0).x).toBeLessThan(byId.get(1).x);
    expect(byId.get(1).x).toBeLessThan(byId.get(2).x);
  });

  it("still arranges left-to-right when the automaton has a cycle, instead of falling back to the force-directed blob (reported: an a*b-regex-shaped NFA with a small back-edge loop should still read left-to-right)", async () => {
    const hosts = fakeHosts();
    const client = fakeClient({
      docSnapshot: vi.fn().mockResolvedValue({
        revision: 0,
        states: [
          { id: 0, label: "q0", x: 0, y: 0, initial: true, accepting: false },
          { id: 1, label: "q1", x: 0, y: 0, initial: false, accepting: false },
          { id: 2, label: "q2", x: 0, y: 0, initial: false, accepting: true },
        ],
        edges: [
          { from: 0, to: 1, epsilon: false, symbols: ["a"] },
          { from: 1, to: 0, epsilon: true, symbols: [] }, // closes a cycle back to q0
          { from: 1, to: 2, epsilon: false, symbols: ["b"] },
        ],
        derived: { classification: "Afn", alphabet: ["a", "b"], unreachable: [] },
      }),
      docApply: vi.fn().mockResolvedValue({ revision: 1, patches: [], derived: { alphabet: [], classification: "Afn", unreachable: [] } }),
    });
    const mount = mountFaTab(0, hosts, client);
    await Promise.resolve();

    await mount.ctx.layout.arrange();

    const ops = client.docApply.mock.calls[0][0];
    const byId = new Map(ops.map((op) => [op.id, op]));
    expect(byId.get(0).x).toBeLessThan(byId.get(1).x);
    expect(byId.get(1).x).toBeLessThan(byId.get(2).x);
  });
});
