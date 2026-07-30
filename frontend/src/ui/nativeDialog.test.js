import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Tauri v2 dialog plugin — real dialog behavior can only be
// exercised in a genuine Tauri webview (see PR6's apply-progress notes: a
// human still needs to click through the actual OS file picker). This
// covers everything Vitest/jsdom *can* prove: the right plugin function is
// called with the right filter, and a null/undefined result normalizes to
// `null` for a cancelled dialog.
const open = vi.fn();
const save = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...args) => open(...args), save: (...args) => save(...args) }));

const { pickOpenPath, pickSavePath } = await import("./nativeDialog.js");

beforeEach(() => {
  open.mockReset();
  save.mockReset();
});

describe("pickOpenPath (task 7.7)", () => {
  it("calls the plugin's open() restricted to .jff files and returns the chosen path", async () => {
    open.mockResolvedValue("/home/user/automaton.jff");
    const path = await pickOpenPath();
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ multiple: false, filters: [{ name: "JFLAP file", extensions: ["jff"] }] }),
    );
    expect(path).toBe("/home/user/automaton.jff");
  });

  it("returns null when the dialog is cancelled", async () => {
    open.mockResolvedValue(null);
    expect(await pickOpenPath()).toBeNull();
  });
});

describe("pickSavePath (task 7.7)", () => {
  it("calls the plugin's save() with a default filename and .jff filter", async () => {
    save.mockResolvedValue("/home/user/out.jff");
    const path = await pickSavePath();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "automaton.jff",
        filters: [{ name: "JFLAP file", extensions: ["jff"] }],
      }),
    );
    expect(path).toBe("/home/user/out.jff");
  });

  it("returns null when the dialog is cancelled", async () => {
    save.mockResolvedValue(undefined);
    expect(await pickSavePath()).toBeNull();
  });
});
