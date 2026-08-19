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
});
