import { beforeEach, describe, expect, it, vi } from "vitest";
import { MealyDocStore } from "../../store/MealyDocStore.js";
import { MealyContext } from "../../commands/MealyContext.js";
import { MealyToolbar } from "./MealyToolbar.js";

function setup() {
  const client = { mealySnapshot: vi.fn(), mealyApply: vi.fn(), mealyUndo: vi.fn(), mealyRedo: vi.fn() };
  const docStore = new MealyDocStore(client);
  const ctx = new MealyContext(docStore);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const toolbar = new MealyToolbar(container, ctx);
  return { ctx, container, toolbar };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("MealyToolbar", () => {
  it("renders exactly the 4 core tools", () => {
    const { container } = setup();
    const buttons = container.querySelectorAll('[data-group="tools"] [data-tool]');
    expect([...buttons].map((b) => b.dataset.tool)).toEqual([
      "select",
      "create-state",
      "create-transition",
      "delete",
    ]);
  });

  it("clicking a tool button sets the active tool and highlights it", () => {
    const { container, ctx } = setup();
    const createStateBtn = container.querySelector('[data-tool="create-state"]');
    createStateBtn.click();

    expect(ctx.activeTool).toBe("create-state");
    expect(createStateBtn.classList.contains("active")).toBe(true);
    expect(container.querySelector('[data-tool="select"]').classList.contains("active")).toBe(false);
  });

  it("disables 'Marcar inicial' unless a state is selected", () => {
    const { container, ctx } = setup();
    const button = container.querySelector(".mealy-toolbar > .tool-btn:last-child");
    expect(button.disabled).toBe(true);

    ctx.setSelection({ kind: "state", id: 1 });
    expect(button.disabled).toBe(false);

    ctx.setSelection({ kind: "edge", from: 1, to: 2 });
    expect(button.disabled).toBe(true);
  });

  it("calls the wired markInitial callback on click", () => {
    const { ctx, toolbar } = setup();
    ctx.setSelection({ kind: "state", id: 1 }); // the button is disabled with no selection
    const markInitial = vi.fn();
    toolbar.markInitial = markInitial;
    toolbar.markInitialButton.click();
    expect(markInitial).toHaveBeenCalled();
  });
});
