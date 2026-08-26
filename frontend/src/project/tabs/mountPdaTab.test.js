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
