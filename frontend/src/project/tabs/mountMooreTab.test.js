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
