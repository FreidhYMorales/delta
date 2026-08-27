import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdates } from "./updater.js";

const { check, ask } = vi.hoisted(() => ({
  check: vi.fn(),
  ask: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

beforeEach(() => {
  check.mockReset();
  ask.mockReset();
});

describe("checkForUpdates", () => {
  it("does nothing when no update is available", async () => {
    check.mockResolvedValue(null);

    await checkForUpdates();

    expect(ask).not.toHaveBeenCalled();
  });

  it("asks the user before installing, and skips the install when declined", async () => {
    const downloadAndInstall = vi.fn();
    check.mockResolvedValue({ version: "0.3.0", downloadAndInstall });
    ask.mockResolvedValue(false);

    await checkForUpdates();

    expect(ask).toHaveBeenCalledWith(expect.stringContaining("0.3.0"), expect.objectContaining({ title: expect.any(String) }));
    expect(downloadAndInstall).not.toHaveBeenCalled();
  });

  it("downloads, installs, and relaunches when the user accepts", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    check.mockResolvedValue({ version: "0.3.0", downloadAndInstall });
    ask.mockResolvedValue(true);
    const { relaunch } = await import("@tauri-apps/plugin-process");

    await checkForUpdates();

    expect(downloadAndInstall).toHaveBeenCalled();
    expect(relaunch).toHaveBeenCalled();
  });

  it("swallows a failed check instead of throwing (e.g. offline, or no real webview)", async () => {
    check.mockRejectedValue(new Error("network down"));

    await expect(checkForUpdates()).resolves.toBeUndefined();
  });
});
