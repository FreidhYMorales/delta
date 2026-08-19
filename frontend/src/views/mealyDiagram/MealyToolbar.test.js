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
  return { client, ctx, container, toolbar };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("MealyToolbar", () => {
  it("renders exactly the 4 core tools, sourced from mealyRegistry.js", () => {
    const { container } = setup();
    const buttons = container.querySelectorAll('[data-group="tools"] [data-action]');
    expect([...buttons].map((b) => b.dataset.action)).toEqual([
      "tool.select",
      "tool.createState",
      "tool.createTransition",
      "tool.delete",
    ]);
  });

  it("shows the V/S/T/D keybinding badges", () => {
    const { container } = setup();
    const kbds = [...container.querySelectorAll('[data-group="tools"] kbd')].map((k) => k.textContent);
    expect(kbds).toEqual(["V", "S", "T", "D"]);
  });

  it("clicking a tool button sets the active tool and highlights it", () => {
    const { container, ctx } = setup();
    const createStateBtn = container.querySelector('[data-action="tool.createState"]');
    createStateBtn.click();

    expect(ctx.activeTool).toBe("create-state");
    expect(createStateBtn.classList.contains("active")).toBe(true);
    expect(container.querySelector('[data-action="tool.select"]').classList.contains("active")).toBe(false);
  });

  it("disables 'Marcar inicial' unless a state is selected", () => {
    const { container, ctx } = setup();
    const button = container.querySelector('[data-action="state.markInitial"]');
    expect(button.disabled).toBe(true);

    ctx.setSelection({ kind: "state", id: 1 });
    expect(button.disabled).toBe(false);

    ctx.setSelection({ kind: "edge", from: 1, to: 2 });
    expect(button.disabled).toBe(true);
  });

  it("clicking 'Marcar inicial' runs the state.markInitial registry action", async () => {
    const { client, ctx, toolbar } = setup();
    client.mealyApply.mockResolvedValue({
      revision: 1,
      patches: [],
      derived: { input_alphabet: [], output_alphabet: [], deterministic: true, unreachable: [] },
    });
    ctx.setSelection({ kind: "state", id: 1 });
    toolbar.markInitialButton.click();
    await Promise.resolve();
    expect(client.mealyApply).toHaveBeenCalledWith([{ op: "SetInitial", id: 1 }]);
  });
});
