import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountMooreTab } from "./mountMooreTab.js";

function emptySnapshot(revision = 0) {
  return {
    revision,
    states: [],
    edges: [],
    derived: { input_alphabet: [], output_alphabet: [], deterministic: true, unreachable: [] },
  };
}

function fakeClient(overrides = {}) {
  return {
    mooreSnapshot: vi.fn().mockResolvedValue(emptySnapshot()),
    mooreApply: vi.fn(),
    mooreUndo: vi.fn(),
    mooreRedo: vi.fn(),
    mooreOpen: vi.fn(),
    mooreSave: vi.fn(),
    mooreSim: vi.fn(),
    ...overrides,
  };
}

function fakeHosts() {
  return { contentHost: document.createElement("div"), toolbarHost: document.createElement("div") };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("mountMooreTab dirty-tracking (design D10: threads docStore.revision back to ProjectStore)", () => {
  it("calls projectStore.updateTabRevision(tabId, revision) whenever docStore notifies", async () => {
    const hosts = fakeHosts();
    const updateTabRevision = vi.fn();
    const client = fakeClient({
      mooreApply: vi.fn().mockResolvedValue({
        revision: 1,
        patches: [],
        derived: { input_alphabet: [], output_alphabet: [], deterministic: true, unreachable: [] },
      }),
    });
    const mount = mountMooreTab(7, hosts, client, { projectStore: { updateTabRevision } });
    await Promise.resolve();
    updateTabRevision.mockClear();

    await mount.docStore.apply([{ op: "AddState", label: "q0", x: 0, y: 0 }]);

    expect(updateTabRevision).toHaveBeenCalledWith(7, 1);
  });

  it("does not throw when no projectStore collaborator is given", async () => {
    const hosts = fakeHosts();
    expect(() => mountMooreTab(0, hosts, fakeClient())).not.toThrow();
  });
});

describe("mountMooreTab (design D11)", () => {
  it("mounts a hidden .app-body/.toolbar pair", async () => {
    const hosts = fakeHosts();
    const mount = mountMooreTab(0, hosts, fakeClient());
    await Promise.resolve();

    expect(hosts.contentHost.contains(mount.root)).toBe(true);
    expect(hosts.toolbarHost.contains(mount.toolbarRoot)).toBe(true);
    expect(mount.root.hidden).toBe(true);
    expect(mount.toolbarRoot.hidden).toBe(true);
  });

  it("activate() un-hides root/toolbar AND re-triggers viewport.fitToWindow()", async () => {
    const hosts = fakeHosts();
    const mount = mountMooreTab(0, hosts, fakeClient());
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
    const mount = mountMooreTab(0, hosts, fakeClient());
    await Promise.resolve();
    const svg = mount.root.querySelector("svg");
    const focus = vi.fn();
    svg.focus = focus;

    mount.activate();

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("deactivate() re-hides root/toolbar", async () => {
    const hosts = fakeHosts();
    const mount = mountMooreTab(0, hosts, fakeClient());
    await Promise.resolve();
    mount.activate();

    mount.deactivate();

    expect(mount.root.hidden).toBe(true);
    expect(mount.toolbarRoot.hidden).toBe(true);
  });
});

describe("mountMooreTab ctx.promptInput / ctx.promptOutput Greek-letter conversion", () => {
  it("promptInput converts a typed Greek letter name to its symbol", async () => {
    const hosts = fakeHosts();
    const mount = mountMooreTab(0, hosts, fakeClient());
    await Promise.resolve();

    const resultPromise = mount.ctx.promptInput();
    const input = document.querySelector(".prompt-modal-input");
    input.value = "sigma";
    document.querySelector(".prompt-modal-ok").click();

    expect(await resultPromise).toBe("σ");
  });

  it("promptOutput converts a typed Greek letter name to its symbol", async () => {
    const hosts = fakeHosts();
    const mount = mountMooreTab(0, hosts, fakeClient());
    await Promise.resolve();

    const resultPromise = mount.ctx.promptOutput(0);
    const input = document.querySelector(".prompt-modal-input");
    input.value = "delta";
    document.querySelector(".prompt-modal-ok").click();

    expect(await resultPromise).toBe("δ");
  });
});
