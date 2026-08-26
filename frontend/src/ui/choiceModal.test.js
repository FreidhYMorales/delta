import { beforeEach, describe, expect, it } from "vitest";
import { choiceModal } from "./choiceModal.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("choiceModal (Save/Discard/Cancel — used for the 'unsaved changes' flow, PR11 wires the callers)", () => {
  it("renders an overlay with the message and exactly 3 buttons: Save, Discard, Cancel", () => {
    choiceModal("You have unsaved changes");
    const box = document.querySelector(".choice-modal");
    expect(box).not.toBeNull();
    expect(box.textContent).toContain("You have unsaved changes");
    expect(document.querySelector(".choice-modal-save")).not.toBeNull();
    expect(document.querySelector(".choice-modal-discard")).not.toBeNull();
    expect(document.querySelector(".choice-modal-cancel")).not.toBeNull();
  });

  it("resolves 'save' when Save is clicked", async () => {
    const result = choiceModal("Unsaved changes");
    document.querySelector(".choice-modal-save").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(await result).toBe("save");
  });

  it("resolves 'discard' when Discard is clicked", async () => {
    const result = choiceModal("Unsaved changes");
    document.querySelector(".choice-modal-discard").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(await result).toBe("discard");
  });

  it("resolves 'cancel' when Cancel is clicked", async () => {
    const result = choiceModal("Unsaved changes");
    document.querySelector(".choice-modal-cancel").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(await result).toBe("cancel");
  });

  it("resolves 'cancel' on Escape, same as clicking Cancel", async () => {
    const result = choiceModal("Unsaved changes");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await result).toBe("cancel");
  });

  it("resolves 'cancel' when clicking the backdrop outside the modal box", async () => {
    const result = choiceModal("Unsaved changes");
    document.querySelector(".choice-modal-overlay").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(await result).toBe("cancel");
  });

  it("never resolves with a 4th value — only exactly one of save/discard/cancel", async () => {
    const outcomes = [];
    for (const selector of [".choice-modal-save", ".choice-modal-discard", ".choice-modal-cancel"]) {
      const result = choiceModal("Unsaved changes");
      document.querySelector(selector).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      outcomes.push(await result);
    }
    for (const outcome of outcomes) {
      expect(["save", "discard", "cancel"]).toContain(outcome);
    }
    expect(new Set(outcomes).size).toBe(3);
  });

  it("removes itself from the DOM once resolved", async () => {
    const result = choiceModal("Unsaved changes");
    document.querySelector(".choice-modal-cancel").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await result;

    expect(document.querySelector(".choice-modal-overlay")).toBeNull();
  });

  it("does not throw when a second modal is opened while the first is still pending (no shared global state)", async () => {
    const first = choiceModal("First");
    expect(() => choiceModal("Second")).not.toThrow();
    const overlays = document.querySelectorAll(".choice-modal-overlay");
    expect(overlays.length).toBe(2);
    overlays[0].querySelector(".choice-modal-cancel").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    overlays[1].querySelector(".choice-modal-cancel").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(await first).toBe("cancel");
  });
});
