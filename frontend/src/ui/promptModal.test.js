import { beforeEach, describe, expect, it } from "vitest";
import { promptModal } from "./promptModal.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("promptModal (bug 2: window.prompt is unreliable in the Tauri webview)", () => {
  it("renders an overlay with the message and a pre-filled input", () => {
    promptModal("Rename state", "q0");
    const box = document.querySelector(".prompt-modal");
    expect(box).not.toBeNull();
    expect(box.textContent).toContain("Rename state");
    const input = document.querySelector(".prompt-modal-input");
    expect(input.value).toBe("q0");
  });

  it("resolves with the input's value when OK is clicked", async () => {
    const result = promptModal("Transition symbol", "");
    const input = document.querySelector(".prompt-modal-input");
    input.value = "z";
    document.querySelector(".prompt-modal-ok").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(await result).toBe("z");
  });

  it("resolves with null when Cancel is clicked", async () => {
    const result = promptModal("Transition symbol", "");
    document.querySelector(".prompt-modal-cancel").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(await result).toBeNull();
  });

  it("resolves with null on Escape", async () => {
    const result = promptModal("Transition symbol", "");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(await result).toBeNull();
  });

  it("resolves with the input's value on Enter", async () => {
    const result = promptModal("Transition symbol", "");
    const input = document.querySelector(".prompt-modal-input");
    input.value = "a";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(await result).toBe("a");
  });

  it("resolves with null when clicking the backdrop outside the modal box", async () => {
    const result = promptModal("Transition symbol", "");
    document.querySelector(".prompt-modal-overlay").dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true }),
    );

    expect(await result).toBeNull();
  });

  it("removes itself from the DOM once resolved", async () => {
    const result = promptModal("Transition symbol", "");
    document.querySelector(".prompt-modal-cancel").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await result;

    expect(document.querySelector(".prompt-modal-overlay")).toBeNull();
  });
});
