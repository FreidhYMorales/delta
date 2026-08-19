import { beforeEach, describe, expect, it, vi } from "vitest";
import { MooreDocStore } from "../../store/MooreDocStore.js";
import { MooreContext } from "../../commands/MooreContext.js";
import { MooreToolbar } from "./MooreToolbar.js";

function setup() {
  const client = { mooreSnapshot: vi.fn(), mooreApply: vi.fn(), mooreUndo: vi.fn(), mooreRedo: vi.fn() };
  const docStore = new MooreDocStore(client);
  const ctx = new MooreContext(docStore);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const toolbar = new MooreToolbar(container, ctx);
  return { client, ctx, container, toolbar };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("MooreToolbar", () => {
  it("renders exactly the 4 core tools, sourced from mooreRegistry.js", () => {
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

  it("disables 'Marcar inicial' and 'Fijar salida' unless a state is selected", () => {
    const { container, ctx } = setup();
    const markInitial = container.querySelector('[data-action="state.markInitial"]');
    const setOutput = container.querySelector('[data-action="state.setOutput"]');
    expect(markInitial.disabled).toBe(true);
    expect(setOutput.disabled).toBe(true);

    ctx.setSelection({ kind: "state", id: 1 });
    expect(markInitial.disabled).toBe(false);
    expect(setOutput.disabled).toBe(false);

    ctx.setSelection({ kind: "edge", from: 1, to: 2 });
    expect(markInitial.disabled).toBe(true);
    expect(setOutput.disabled).toBe(true);
  });

  it("clicking 'Marcar inicial' runs the state.markInitial registry action", async () => {
    const { client, ctx, toolbar } = setup();
    client.mooreApply.mockResolvedValue({
      revision: 1,
      patches: [],
      derived: { input_alphabet: [], output_alphabet: [], deterministic: true, unreachable: [] },
    });
    ctx.setSelection({ kind: "state", id: 1 });
    toolbar.markInitialButton.click();
    await Promise.resolve();
    expect(client.mooreApply).toHaveBeenCalledWith([{ op: "SetInitial", id: 1 }]);
  });

  it("clicking 'Fijar salida' runs the state.setOutput registry action (no Mealy equivalent)", async () => {
    const promptOutput = vi.fn().mockResolvedValue("even");
    const docStore = new MooreDocStore({ mooreSnapshot: vi.fn(), mooreApply: vi.fn(), mooreUndo: vi.fn(), mooreRedo: vi.fn() });
    docStore.client.mooreApply.mockResolvedValue({
      revision: 1,
      patches: [],
      derived: { input_alphabet: [], output_alphabet: [], deterministic: true, unreachable: [] },
    });
    const ctx = new MooreContext(docStore, { promptOutput });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const toolbar = new MooreToolbar(container, ctx);

    ctx.setSelection({ kind: "state", id: 1 });
    toolbar.setOutputButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(promptOutput).toHaveBeenCalledWith(1);
    expect(docStore.client.mooreApply).toHaveBeenCalledWith([{ op: "SetOutput", state: 1, output: "even" }]);
  });
});
