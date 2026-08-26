import { beforeEach, describe, expect, it } from "vitest";
import { createTabs } from "./tabs.js";

let container;

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
});

describe("createTabs", () => {
  it("renders one button and one panel per tab", () => {
    createTabs(container, [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    expect(container.querySelectorAll(".tab")).toHaveLength(2);
    expect(container.querySelectorAll(".tab-panel")).toHaveLength(2);
  });

  it("selects the first tab by default", () => {
    const { panels } = createTabs(container, [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    expect(container.querySelector('.tab[role="tab"]').classList.contains("active")).toBe(true);
    expect(panels.get("a").classList.contains("active")).toBe(true);
    expect(panels.get("b").classList.contains("active")).toBe(false);
  });

  it("clicking a tab button switches the active panel", () => {
    const { panels } = createTabs(container, [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    const buttons = container.querySelectorAll(".tab");
    buttons[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(panels.get("a").classList.contains("active")).toBe(false);
    expect(panels.get("b").classList.contains("active")).toBe(true);
  });

  it("select(id) switches tabs programmatically, e.g. for a Calcular -> Resultados flow", () => {
    const { select, panels, selected } = createTabs(container, [
      { id: "cadena", label: "Cadena" },
      { id: "resultados", label: "Resultados" },
    ]);
    select("resultados");
    expect(selected()).toBe("resultados");
    expect(panels.get("resultados").classList.contains("active")).toBe(true);
    expect(panels.get("cadena").classList.contains("active")).toBe(false);
  });

  it("ignores select() with an unknown id", () => {
    const { select, selected } = createTabs(container, [{ id: "a", label: "A" }]);
    select("nope");
    expect(selected()).toBe("a");
  });

  it("returns the panel elements so callers can append their own content into them", () => {
    const { panels } = createTabs(container, [{ id: "a", label: "A" }]);
    const child = document.createElement("span");
    child.textContent = "hello";
    panels.get("a").appendChild(child);
    expect(container.querySelector(".tab-panel").textContent).toBe("hello");
  });

  it("re-clicking the active tab does nothing when not collapsible (unchanged default behavior)", () => {
    const { panels } = createTabs(container, [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    const buttons = container.querySelectorAll(".tab");
    buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(panels.get("a").classList.contains("active")).toBe(true);
    expect(container.classList.contains("tabs-collapsed")).toBe(false);
  });
});

describe("createTabs({ collapsible: true }) — pin the strip, hide the content", () => {
  it("re-clicking the active tab collapses the content but keeps the tab strip", () => {
    const { panels } = createTabs(
      container,
      [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      { collapsible: true },
    );
    const buttons = container.querySelectorAll(".tab");
    buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(container.classList.contains("tabs-collapsed")).toBe(true);
    expect(container.querySelector(".tabs")).toBeTruthy(); // strip stays in the DOM
    expect(panels.get("a").classList.contains("active")).toBe(true); // selection itself is untouched
  });

  it("clicking the same tab again expands it back", () => {
    const { isCollapsed } = createTabs(container, [{ id: "a", label: "A" }], { collapsible: true });
    const button = container.querySelector(".tab");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(isCollapsed()).toBe(true);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(isCollapsed()).toBe(false);
    expect(container.classList.contains("tabs-collapsed")).toBe(false);
  });

  it("clicking a different tab while collapsed expands and switches to it", () => {
    const { panels, isCollapsed } = createTabs(
      container,
      [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      { collapsible: true },
    );
    const buttons = container.querySelectorAll(".tab");
    buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true })); // collapse "a"
    expect(isCollapsed()).toBe(true);

    buttons[1].dispatchEvent(new MouseEvent("click", { bubbles: true })); // switch to "b"
    expect(isCollapsed()).toBe(false);
    expect(panels.get("b").classList.contains("active")).toBe(true);
  });

  it("calls onCollapsedChange with the new state on every toggle", () => {
    const seen = [];
    createTabs(container, [{ id: "a", label: "A" }], {
      collapsible: true,
      onCollapsedChange: (collapsed) => seen.push(collapsed),
    });
    const button = container.querySelector(".tab");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(seen).toEqual([true, false]);
  });
});
