import { beforeEach, describe, expect, it, vi } from "vitest";
import { TmDocStore } from "../../store/TmDocStore.js";
import { TmContext } from "../../commands/TmContext.js";
import { TmToolbar } from "./TmToolbar.js";

function fakeClient(overrides = {}) {
  return { tmSnapshot: vi.fn(), tmApply: vi.fn(), tmUndo: vi.fn(), tmRedo: vi.fn(), ...overrides };
}

function setup(ctxHooks = {}) {
  const client = fakeClient();
  const docStore = new TmDocStore(client);
  const ctx = new TmContext(docStore, ctxHooks);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const toolbar = new TmToolbar(container, ctx);
  return { client, docStore, ctx, container, toolbar };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("TmToolbar", () => {
  it("renders exactly the 4 core tools, sourced from tmRegistry.js", () => {
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
    client.tmApply.mockResolvedValue({
      revision: 1,
      patches: [],
      derived: { alphabet: [], tape_count: 0, deterministic: true, unreachable: [] },
    });
    ctx.setSelection({ kind: "state", id: 1 });
    toolbar.markInitialButton.click();
    await Promise.resolve();
    expect(client.tmApply).toHaveBeenCalledWith([{ op: "SetInitial", id: 1 }]);
  });

  it("clicking 'Alternar aceptación' runs the state.toggleAccepting registry action", async () => {
    const client = fakeClient();
    const docStore = new TmDocStore(client);
    client.tmSnapshot.mockResolvedValue({
      revision: 0,
      states: [{ id: 1, label: "q0", x: 0, y: 0, initial: true, accepting: false }],
      transitions: [],
      derived: { alphabet: [], tape_count: 0, deterministic: true, unreachable: [] },
    });
    await docStore.load();
    client.tmApply.mockResolvedValue({
      revision: 1,
      patches: [],
      derived: { alphabet: [], tape_count: 0, deterministic: true, unreachable: [] },
    });
    const ctx = new TmContext(docStore);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const toolbar = new TmToolbar(container, ctx);

    ctx.setSelection({ kind: "state", id: 1 });
    toolbar.toggleAcceptingButton.click();
    await Promise.resolve();

    expect(client.tmApply).toHaveBeenCalledWith([{ op: "SetAccepting", id: 1, accepting: true }]);
  });
});

describe("TmToolbar tape-count select", () => {
  it("reflects ctx.tapeCountChoice pre-lock and is not disabled", () => {
    const { container, ctx } = setup();
    ctx.setTapeCountChoice(3);
    const select = container.querySelector(".tm-tape-count-select");
    expect(select.value).toBe("3");
    expect(select.disabled).toBe(false);
  });

  it("changing the select calls ctx.setTapeCountChoice", () => {
    const { container, ctx } = setup();
    const select = container.querySelector(".tm-tape-count-select");
    select.value = "4";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(ctx.tapeCountChoice).toBe(4);
  });

  it("reflects docStore.derived.tape_count once locked, ignoring ctx.tapeCountChoice, and is disabled", async () => {
    const client = fakeClient();
    client.tmSnapshot.mockResolvedValue({
      revision: 0,
      states: [],
      transitions: [{ id: 1, from: 1, to: 1, tapes: [{ read: "a", write: "a", direction: "S" }] }],
      derived: { alphabet: ["a"], tape_count: 2, deterministic: true, unreachable: [] },
    });
    const docStore = new TmDocStore(client);
    await docStore.load();
    const ctx = new TmContext(docStore);
    ctx.setTapeCountChoice(5);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const toolbar = new TmToolbar(container, ctx);

    const select = container.querySelector(".tm-tape-count-select");
    expect(select.value).toBe("2");
    expect(select.disabled).toBe(true);
  });
});
