import { beforeEach, describe, expect, it, vi } from "vitest";
import { PdaDocStore } from "../../store/PdaDocStore.js";
import { PdaContext } from "../../commands/PdaContext.js";
import { PdaToolbar } from "./PdaToolbar.js";

function fakeClient(overrides = {}) {
  return { pdaSnapshot: vi.fn(), pdaApply: vi.fn(), pdaUndo: vi.fn(), pdaRedo: vi.fn(), ...overrides };
}

function setup(ctxHooks = {}) {
  const client = fakeClient();
  const docStore = new PdaDocStore(client);
  const ctx = new PdaContext(docStore, ctxHooks);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const toolbar = new PdaToolbar(container, ctx);
  return { client, docStore, ctx, container, toolbar };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("PdaToolbar", () => {
  it("renders exactly the 4 core tools, sourced from pdaRegistry.js", () => {
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

  it("disables 'Marcar inicial' and 'Alternar aceptación' unless a state is selected", () => {
    const { container, ctx } = setup();
    const markInitial = container.querySelector('[data-action="state.markInitial"]');
    const toggleAccepting = container.querySelector('[data-action="state.toggleAccepting"]');
    expect(markInitial.disabled).toBe(true);
    expect(toggleAccepting.disabled).toBe(true);

    ctx.setSelection({ kind: "state", id: 1 });
    expect(markInitial.disabled).toBe(false);
    expect(toggleAccepting.disabled).toBe(false);

    ctx.setSelection({ kind: "transition", id: 1 });
    expect(markInitial.disabled).toBe(true);
    expect(toggleAccepting.disabled).toBe(true);
  });

  it("clicking 'Marcar inicial' runs the state.markInitial registry action", async () => {
    const { client, ctx, toolbar } = setup();
    client.pdaApply.mockResolvedValue({
      revision: 1,
      patches: [],
      derived: { input_alphabet: [], stack_alphabet: [], deterministic: true, unreachable: [] },
    });
    ctx.setSelection({ kind: "state", id: 1 });
    toolbar.markInitialButton.click();
    await Promise.resolve();
    expect(client.pdaApply).toHaveBeenCalledWith([{ op: "SetInitial", id: 1 }]);
  });

  it("clicking 'Alternar aceptación' runs the state.toggleAccepting registry action (no Mealy/Moore equivalent)", async () => {
    const client = fakeClient();
    const docStore = new PdaDocStore(client);
    client.pdaSnapshot.mockResolvedValue({
      revision: 0,
      states: [{ id: 1, label: "q0", x: 0, y: 0, initial: true, accepting: false }],
      transitions: [],
      derived: { input_alphabet: [], stack_alphabet: [], deterministic: true, unreachable: [] },
    });
    await docStore.load();
    client.pdaApply.mockResolvedValue({
      revision: 1,
      patches: [],
      derived: { input_alphabet: [], stack_alphabet: [], deterministic: true, unreachable: [] },
    });
    const ctx = new PdaContext(docStore);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const toolbar = new PdaToolbar(container, ctx);

    ctx.setSelection({ kind: "state", id: 1 });
    toolbar.toggleAcceptingButton.click();
    await Promise.resolve();

    expect(client.pdaApply).toHaveBeenCalledWith([{ op: "SetAccepting", id: 1, accepting: true }]);
  });
});
