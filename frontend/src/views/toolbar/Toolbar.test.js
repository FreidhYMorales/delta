import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../../store/DocStore.js";
import { ViewContext } from "../../commands/context.js";
import { Toolbar } from "./Toolbar.js";

function setup() {
  const client = {
    docSnapshot: vi.fn(),
    docApply: vi.fn(),
    docUndo: vi.fn(),
    docRedo: vi.fn(),
  };
  const docStore = new DocStore(client);
  const ctx = new ViewContext(docStore);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const toolbar = new Toolbar(container, ctx);
  return { ctx, container, toolbar };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("Toolbar (moved out of DiagramView for wireframe parity: it spans the full app width)", () => {
  it("renders exactly the 4 core tools, sourced from the command registry", () => {
    const { container } = setup();
    const buttons = container.querySelectorAll('[data-group="tools"] [data-action]');
    expect([...buttons].map((b) => b.dataset.action)).toEqual([
      "tool.select",
      "tool.createState",
      "tool.createTransition",
      "tool.delete",
    ]);
  });

  it("renders the view actions (circle layout, fit to window) as a second toolbar group, separated by a divider", () => {
    const { container } = setup();
    const buttons = container.querySelectorAll('[data-group="view"] [data-action]');
    expect([...buttons].map((b) => b.dataset.action)).toEqual([
      "view.autoLayout",
      "view.fitToWindow",
    ]);
    expect(container.querySelector(".toolbar-sep")).not.toBeNull();
  });

  it("does not render an Editor mode <select> (removed in PR11: a project can hold several open tabs of different kinds at once)", () => {
    const { container } = setup();
    expect(container.querySelector(".mode-select")).toBeNull();
  });

  it("clicking a toolbar button dispatches the matching registry action and highlights it", () => {
    const { container, ctx } = setup();
    const createStateBtn = container.querySelector('[data-action="tool.createState"]');
    createStateBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(ctx.activeTool).toBe("create-state");
    expect(createStateBtn.classList.contains("active")).toBe(true);
    expect(
      container.querySelector('[data-action="tool.select"]').classList.contains("active"),
    ).toBe(false);
  });
});
