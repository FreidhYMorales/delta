import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountPdaTab } from "./mountPdaTab.js";

function emptySnapshot(revision = 0) {
  return {
    revision,
    states: [],
    transitions: [],
    derived: { input_alphabet: [], stack_alphabet: [], deterministic: true, unreachable: [] },
  };
}

function fakeClient(overrides = {}) {
  return {
    pdaSnapshot: vi.fn().mockResolvedValue(emptySnapshot()),
    pdaApply: vi.fn(),
    pdaUndo: vi.fn(),
    pdaRedo: vi.fn(),
    pdaOpen: vi.fn(),
    pdaSave: vi.fn(),
    pdaSim: vi.fn(),
    ...overrides,
  };
}

function fakeHosts() {
  return { contentHost: document.createElement("div"), toolbarHost: document.createElement("div") };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("mountPdaTab dirty-tracking (design D10: threads docStore.revision back to ProjectStore)", () => {
  it("calls projectStore.updateTabRevision(tabId, revision) whenever docStore notifies", async () => {
    const hosts = fakeHosts();
    const updateTabRevision = vi.fn();
    const client = fakeClient({
      pdaApply: vi.fn().mockResolvedValue({
        revision: 1,
        patches: [],
        derived: { input_alphabet: [], stack_alphabet: [], deterministic: true, unreachable: [] },
      }),
    });
    const mount = mountPdaTab(7, hosts, client, { projectStore: { updateTabRevision } });
    await Promise.resolve();
    updateTabRevision.mockClear();

    await mount.docStore.apply([{ op: "AddState", label: "q0", x: 0, y: 0 }]);

    expect(updateTabRevision).toHaveBeenCalledWith(7, 1);
  });

  it("does not throw when no projectStore collaborator is given", async () => {
    const hosts = fakeHosts();
    expect(() => mountPdaTab(0, hosts, fakeClient())).not.toThrow();
  });
});

describe("mountPdaTab (design D11)", () => {
  it("mounts a hidden .app-body/.toolbar pair", async () => {
    const hosts = fakeHosts();
    const mount = mountPdaTab(0, hosts, fakeClient());
    await Promise.resolve();

    expect(hosts.contentHost.contains(mount.root)).toBe(true);
    expect(hosts.toolbarHost.contains(mount.toolbarRoot)).toBe(true);
    expect(mount.root.hidden).toBe(true);
    expect(mount.toolbarRoot.hidden).toBe(true);
  });

  it("activate() un-hides root/toolbar AND re-triggers viewport.fitToWindow()", async () => {
    const hosts = fakeHosts();
    const mount = mountPdaTab(0, hosts, fakeClient());
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
    const mount = mountPdaTab(0, hosts, fakeClient());
    await Promise.resolve();
    mount.activate();

    mount.deactivate();

    expect(mount.root.hidden).toBe(true);
    expect(mount.toolbarRoot.hidden).toBe(true);
  });
});

describe("mountPdaTab prompt hooks' Greek-letter conversion", () => {
  it("promptInput converts a typed Greek letter name to its symbol", async () => {
    const hosts = fakeHosts();
    const mount = mountPdaTab(0, hosts, fakeClient());
    await Promise.resolve();

    const resultPromise = mount.ctx.promptInput();
    const input = document.querySelector(".prompt-modal-input");
    input.value = "sigma";
    document.querySelector(".prompt-modal-ok").click();

    expect(await resultPromise).toBe("σ");
  });

  it("promptPop/promptPush convert space/comma-separated Greek letter names", async () => {
    const hosts = fakeHosts();
    const mount = mountPdaTab(0, hosts, fakeClient());
    await Promise.resolve();

    const popPromise = mount.ctx.promptPop();
    document.querySelector(".prompt-modal-input").value = "delta, sigma";
    document.querySelector(".prompt-modal-ok").click();
    expect(await popPromise).toBe("δ, σ");

    const pushPromise = mount.ctx.promptPush();
    document.querySelector(".prompt-modal-input").value = "gamma a";
    document.querySelector(".prompt-modal-ok").click();
    expect(await pushPromise).toBe("γ a");
  });
});
