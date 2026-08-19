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
      "view.circleLayout",
      "view.fitToWindow",
    ]);
    expect(container.querySelector(".toolbar-sep")).not.toBeNull();
  });

  it("renders a real <select> for the editor mode, with only 'Autómata Finito' enabled", () => {
    const { container } = setup();
    const select = container.querySelector(".mode-select select");
    const options = [...select.querySelectorAll("option")];
    expect(options[0].textContent).toBe("Autómata Finito");
    expect(options[0].disabled).toBe(false);
    expect(options.slice(1).every((o) => o.disabled)).toBe(true);
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
