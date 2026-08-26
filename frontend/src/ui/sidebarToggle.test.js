import { beforeEach, describe, expect, it } from "vitest";
import { wireSidebarToggle } from "./sidebarToggle.js";

let resizer;
let canvasPane;
let rightCol;

beforeEach(() => {
  document.body.innerHTML = "";
  resizer = document.createElement("div");
  resizer.className = "resizer";
  canvasPane = document.createElement("div");
  canvasPane.className = "canvas-pane";
  rightCol = document.createElement("div");
  rightCol.className = "right-col";
  document.body.append(canvasPane, resizer, rightCol);
});

describe("wireSidebarToggle", () => {
  it("appends a toggle button into the resizer, starting expanded", () => {
    wireSidebarToggle(resizer, canvasPane, rightCol);
    const button = resizer.querySelector(".sidebar-toggle");
    expect(button).toBeTruthy();
    expect(rightCol.classList.contains("sidebar-hidden")).toBe(false);
    expect(canvasPane.classList.contains("canvas-full")).toBe(false);
  });

  it("clicking the button hides the sidebar and lets the canvas take the freed width", () => {
    const { isCollapsed } = wireSidebarToggle(resizer, canvasPane, rightCol);
    resizer.querySelector(".sidebar-toggle").click();

    expect(isCollapsed()).toBe(true);
    expect(rightCol.classList.contains("sidebar-hidden")).toBe(true);
    expect(canvasPane.classList.contains("canvas-full")).toBe(true);
  });

  it("clicking again brings the sidebar back", () => {
    const { isCollapsed } = wireSidebarToggle(resizer, canvasPane, rightCol);
    const button = resizer.querySelector(".sidebar-toggle");
    button.click();
    button.click();

    expect(isCollapsed()).toBe(false);
    expect(rightCol.classList.contains("sidebar-hidden")).toBe(false);
    expect(canvasPane.classList.contains("canvas-full")).toBe(false);
  });

  it("updates the accessible label so it always describes the next click's effect", () => {
    wireSidebarToggle(resizer, canvasPane, rightCol);
    const button = resizer.querySelector(".sidebar-toggle");
    expect(button.getAttribute("aria-label")).toMatch(/ocultar/i);
    button.click();
    expect(button.getAttribute("aria-label")).toMatch(/mostrar/i);
  });

  it("never arms the resizer's own drag when the toggle button is pressed", () => {
    wireSidebarToggle(resizer, canvasPane, rightCol);
    const button = resizer.querySelector(".sidebar-toggle");
    let resizerSawPointerdown = false;
    resizer.addEventListener("pointerdown", () => {
      resizerSawPointerdown = true;
    });
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(resizerSawPointerdown).toBe(false);
  });

  it("suppresses the resizer's own hover-accent bar while hovering the button (it clashed visually with the button's border)", () => {
    wireSidebarToggle(resizer, canvasPane, rightCol);
    const button = resizer.querySelector(".sidebar-toggle");

    button.dispatchEvent(new Event("mouseenter", { bubbles: false }));
    expect(resizer.classList.contains("toggle-hover")).toBe(true);

    button.dispatchEvent(new Event("mouseleave", { bubbles: false }));
    expect(resizer.classList.contains("toggle-hover")).toBe(false);
  });
});
