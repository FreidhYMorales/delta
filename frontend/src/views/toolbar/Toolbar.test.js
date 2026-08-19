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

  it("renders a real <select> for the editor mode: Finito/Expresión Regular/Gramática Regular enabled, PDA/Turing not", () => {
    const { container } = setup();
    const select = container.querySelector(".mode-select select");
    const options = [...select.querySelectorAll("option")];
    expect(options.map((o) => o.textContent)).toEqual([
      "Autómata Finito",
      "Autómata de Pila — próximamente",
      "Máquina de Turing — próximamente",
      "Expresión Regular",
      "Gramática Regular",
    ]);
    expect(options.map((o) => o.disabled)).toEqual([false, true, true, false, false]);
  });

  it("selecting 'Expresión Regular' jumps there via the registry action, then resets to Autómata Finito", () => {
    const { container, ctx } = setup();
    const openRegexTab = vi.fn();
    ctx.openRegexTab = openRegexTab;
    const select = container.querySelector(".mode-select select");

    select.value = "editor.openRegex";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(openRegexTab).toHaveBeenCalled();
    expect(select.value).toBe("finite");
  });

  it("selecting 'Gramática Regular' jumps there via the registry action, then resets to Autómata Finito", () => {
    const { container, ctx } = setup();
    const openGrammarTab = vi.fn();
    ctx.openGrammarTab = openGrammarTab;
    const select = container.querySelector(".mode-select select");

    select.value = "editor.openGrammar";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(openGrammarTab).toHaveBeenCalled();
    expect(select.value).toBe("finite");
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
