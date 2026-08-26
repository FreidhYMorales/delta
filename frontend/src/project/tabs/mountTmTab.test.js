import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountTmTab } from "./mountTmTab.js";

function emptySnapshot(revision = 0) {
  return {
    revision,
    states: [],
    transitions: [],
    derived: { alphabet: [], tape_count: 0, deterministic: true, unreachable: [] },
  };
}

function fakeClient(overrides = {}) {
  return {
    tmSnapshot: vi.fn().mockResolvedValue(emptySnapshot()),
    tmApply: vi.fn(),
    tmUndo: vi.fn(),
    tmRedo: vi.fn(),
    tmOpen: vi.fn(),
    tmSave: vi.fn(),
    tmSim: vi.fn(),
    ...overrides,
  };
}

function fakeHosts() {
  return { contentHost: document.createElement("div"), toolbarHost: document.createElement("div") };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("mountTmTab dirty-tracking (design D10: threads docStore.revision back to ProjectStore)", () => {
  it("calls projectStore.updateTabRevision(tabId, revision) whenever docStore notifies", async () => {
    const hosts = fakeHosts();
    const updateTabRevision = vi.fn();
    const client = fakeClient({
      tmApply: vi.fn().mockResolvedValue({
        revision: 1,
        patches: [],
        derived: { alphabet: [], tape_count: 0, deterministic: true, unreachable: [] },
      }),
    });
    const mount = mountTmTab(7, hosts, client, { projectStore: { updateTabRevision } });
    await Promise.resolve();
    updateTabRevision.mockClear();

    await mount.docStore.apply([{ op: "AddState", label: "q0", x: 0, y: 0 }]);

    expect(updateTabRevision).toHaveBeenCalledWith(7, 1);
  });

  it("does not throw when no projectStore collaborator is given", async () => {
    const hosts = fakeHosts();
    expect(() => mountTmTab(0, hosts, fakeClient())).not.toThrow();
  });
});

describe("mountTmTab (design D11)", () => {
  it("mounts a hidden .app-body/.toolbar pair", async () => {
    const hosts = fakeHosts();
    const mount = mountTmTab(0, hosts, fakeClient());
    await Promise.resolve();

    expect(hosts.contentHost.contains(mount.root)).toBe(true);
    expect(hosts.toolbarHost.contains(mount.toolbarRoot)).toBe(true);
    expect(mount.root.hidden).toBe(true);
    expect(mount.toolbarRoot.hidden).toBe(true);
  });

  it("activate() un-hides root/toolbar AND re-triggers viewport.fitToWindow()", async () => {
    const hosts = fakeHosts();
    const mount = mountTmTab(0, hosts, fakeClient());
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
    const mount = mountTmTab(0, hosts, fakeClient());
    await Promise.resolve();
    const svg = mount.root.querySelector("svg");
    const focus = vi.fn();
    svg.focus = focus;

    mount.activate();

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("deactivate() re-hides root/toolbar", async () => {
    const hosts = fakeHosts();
    const mount = mountTmTab(0, hosts, fakeClient());
    await Promise.resolve();
    mount.activate();

    mount.deactivate();

    expect(mount.root.hidden).toBe(true);
    expect(mount.toolbarRoot.hidden).toBe(true);
  });
});

describe("mountTmTab ctx.promptTape Greek-letter conversion", () => {
  it("converts a typed Greek letter name in the tape format string", async () => {
    const hosts = fakeHosts();
    const mount = mountTmTab(0, hosts, fakeClient());
    await Promise.resolve();

    const resultPromise = mount.ctx.promptTape(0);
    const input = document.querySelector(".prompt-modal-input");
    input.value = "delta;sigma,R";
    document.querySelector(".prompt-modal-ok").click();

    expect(await resultPromise).toBe("δ;σ,R");
  });
});
