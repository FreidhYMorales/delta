import { beforeEach, describe, expect, it } from "vitest";
import { showNotice } from "./notice.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("showNotice (tasks 7.7/7.9: visible, never-silent notices)", () => {
  it("renders a title, message, and item list", () => {
    showNotice({
      kind: "info",
      title: "Import report — 1 item",
      message: "Some elements were changed:",
      items: ["[Lossy] MultiCharSymbol: folded 'ab' into one symbol"],
    });
    const notice = document.querySelector(".notice");
    expect(notice).not.toBeNull();
    expect(notice.classList.contains("notice-info")).toBe(true);
    expect(notice.textContent).toContain("Import report — 1 item");
    expect(notice.textContent).toContain("Some elements were changed");
    expect(notice.querySelectorAll(".notice-items li")).toHaveLength(1);
  });

  it("defaults to kind 'info' and renders with no item list when items is empty", () => {
    showNotice({ title: "Rename blocked", message: "already used" });
    const notice = document.querySelector(".notice");
    expect(notice.classList.contains("notice-info")).toBe(true);
    expect(notice.querySelector(".notice-items")).toBeNull();
  });

  it("supports kind 'error'", () => {
    showNotice({ kind: "error", title: "Rename blocked", message: "x" });
    expect(document.querySelector(".notice-error")).not.toBeNull();
  });

  it("dismisses on close-button click", () => {
    showNotice({ title: "t", message: "m" });
    expect(document.querySelector(".notice")).not.toBeNull();
    document.querySelector(".notice-close").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".notice")).toBeNull();
  });

  it("dismiss() from the returned handle removes the notice", () => {
    const { dismiss } = showNotice({ title: "t", message: "m" });
    dismiss();
    expect(document.querySelector(".notice")).toBeNull();
  });

  it("stacks multiple notices instead of replacing the previous one", () => {
    showNotice({ title: "first", message: "m1" });
    showNotice({ title: "second", message: "m2" });
    expect(document.querySelectorAll(".notice")).toHaveLength(2);
  });
});
