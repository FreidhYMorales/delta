import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountMealyTab } from "./mountMealyTab.js";

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
    mealySnapshot: vi.fn().mockResolvedValue(emptySnapshot()),
    mealyApply: vi.fn(),
    mealyUndo: vi.fn(),
    mealyRedo: vi.fn(),
    mealyOpen: vi.fn(),
    mealySave: vi.fn(),
    mealySim: vi.fn(),
    ...overrides,
  };
}

function fakeHosts() {
  return { contentHost: document.createElement("div"), toolbarHost: document.createElement("div") };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("mountMealyTab (design D11)", () => {
  it("mounts a hidden .app-body/.toolbar pair", async () => {
    const hosts = fakeHosts();
    const mount = mountMealyTab(0, hosts, fakeClient());
    await Promise.resolve();

    expect(hosts.contentHost.contains(mount.root)).toBe(true);
    expect(hosts.toolbarHost.contains(mount.toolbarRoot)).toBe(true);
    expect(mount.root.hidden).toBe(true);
    expect(mount.toolbarRoot.hidden).toBe(true);
  });

  it("activate() un-hides root/toolbar AND re-triggers viewport.fitToWindow()", async () => {
    const hosts = fakeHosts();
    const mount = mountMealyTab(0, hosts, fakeClient());
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
    const mount = mountMealyTab(0, hosts, fakeClient());
    await Promise.resolve();
    mount.activate();

    mount.deactivate();

    expect(mount.root.hidden).toBe(true);
    expect(mount.toolbarRoot.hidden).toBe(true);
  });
});
