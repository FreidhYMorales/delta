import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdaDocStore } from "../../store/PdaDocStore.js";
import { PdaContext } from "../../commands/PdaContext.js";
import { PdaDiagramView } from "./PdaDiagramView.js";

function twoStateSnapshot() {
  return {
    revision: 1,
    states: [
      { id: 1, label: "q0", x: 10, y: 10, initial: true, accepting: false },
      { id: 2, label: "q1", x: 100, y: 10, initial: false, accepting: true },
    ],
    transitions: [{ id: 1, from: 1, to: 2, input: "a", pop: ["Z"], push: ["A", "Z"] }],
    derived: { input_alphabet: ["a"], stack_alphabet: ["A", "Z"], deterministic: true, unreachable: [] },
  };
}

async function setup(snapshot = twoStateSnapshot(), hooks = {}) {
  const client = {
    pdaSnapshot: vi.fn().mockResolvedValue(snapshot),
    pdaApply: vi.fn().mockResolvedValue({ revision: snapshot.revision + 1, patches: [], derived: snapshot.derived }),
    pdaUndo: vi.fn(),
    pdaRedo: vi.fn(),
  };
  const docStore = new PdaDocStore(client);
  await docStore.load();
  const ctx = new PdaContext(docStore, hooks);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new PdaDiagramView(container, docStore, ctx);
  return { client, docStore, ctx, container, view };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("PdaDiagramView rendering", () => {
  it("renders a circle per state and an accepting double-circle only for accepting states", async () => {
    const { container } = await setup();
    expect(container.querySelectorAll("circle[data-state-id]")).toHaveLength(2);
    expect(container.querySelectorAll(".state-accepting-ring")).toHaveLength(1);
    expect(container.querySelector('circle[data-state-id="2"]').classList.contains("accepting")).toBe(true);
    expect(container.querySelector('circle[data-state-id="1"]').classList.contains("accepting")).toBe(false);
  });

  it("renders the initial-state arrow only for the initial state", async () => {
    const { container } = await setup();
    expect(container.querySelectorAll(".initial-arrow")).toHaveLength(1);
    expect(container.querySelector('circle[data-state-id="1"]').classList.contains("initial")).toBe(true);
  });

  it("renders the transition label as 'input , pop ; push', real JFLAP's own format", async () => {
    const { container } = await setup();
    const labels = [...container.querySelectorAll(".edge-label")].map((l) => l.textContent);
    expect(labels).toContain("a , Z ; A, Z");
  });

  it("renders each transition arc keyed by data-transition-id, not data-edge", async () => {
    const { container } = await setup();
    expect(container.querySelector('path.edge[data-transition-id="1"]')).not.toBeNull();
  });

  it("the status bar reports PDA/determinism/state/two-alphabet/transition counts", async () => {
    const { container } = await setup();
    expect(container.querySelector(".status-bar").textContent).toBe("PDA · determinista · Q=2 · Σ=1 · Γ=2 · δ=1");
  });
});

describe("PdaDiagramView multiple transitions between the same pair (the one genuinely new challenge)", () => {
  function twoTransitionsSnapshot() {
    return {
      revision: 1,
      states: [
        { id: 1, label: "q0", x: 10, y: 10, initial: true, accepting: false },
        { id: 2, label: "q1", x: 100, y: 10, initial: false, accepting: false },
      ],
      transitions: [
        { id: 1, from: 1, to: 2, input: "a", pop: [], push: [] },
        { id: 2, from: 1, to: 2, input: "b", pop: ["Z"], push: [] },
      ],
      derived: { input_alphabet: ["a", "b"], stack_alphabet: ["Z"], deterministic: true, unreachable: [] },
    };
  }

  it("renders both transitions as distinct, independently-addressable arcs with distinct labels", async () => {
    const { container } = await setup(twoTransitionsSnapshot());
    const arcs = container.querySelectorAll("path.edge[data-transition-id]");
    expect([...arcs].map((a) => a.dataset.transitionId).sort()).toEqual(["1", "2"]);

    const labels = [...container.querySelectorAll(".edge-label")].map((l) => l.textContent);
    expect(labels).toContain("a , ε ; ε");
    expect(labels).toContain("b , Z ; ε");
  });

  it("the two arcs use different curvature (distinct `d` paths), so they don't overlap", async () => {
    const { container } = await setup(twoTransitionsSnapshot());
    const [d1, d2] = [...container.querySelectorAll("path.edge[data-transition-id]")].map((a) => a.getAttribute("d"));
    expect(d1).not.toBe(d2);
  });

  it("deleting one transition via the delete tool leaves the other untouched", async () => {
    const { container, client, ctx } = await setup(twoTransitionsSnapshot());
    ctx.setTool("delete");
    container.querySelector('path.edge-hit[data-transition-id="2"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(client.pdaApply).toHaveBeenCalledWith([{ op: "RemoveTransition", id: 2 }]);
  });

  it("selecting one via click selects only that transition id, not the whole (from,to) pair", async () => {
    const { container, ctx } = await setup(twoTransitionsSnapshot());
    ctx.setTool("select");
    container.querySelector('path.edge-hit[data-transition-id="1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ctx.selection).toEqual({ kind: "transition", id: 1 });
  });
});

describe("PdaDiagramView create-state (coordinate scaling)", () => {
  it("creates a state at the scaled click position, not the raw client offset", async () => {
    const { container, client, ctx } = await setup({
      revision: 1,
      states: [],
      transitions: [],
      derived: { input_alphabet: [], stack_alphabet: [], deterministic: true, unreachable: [] },
    });
    const svg = container.querySelector(".diagram-canvas");
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 300, height: 200 });
    ctx.setTool("create-state");

    svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 150, clientY: 100 }));

    expect(client.pdaApply).toHaveBeenCalledWith([{ op: "AddState", label: "q0", x: 300, y: 200 }]);
  });
});

describe("PdaDiagramView select/drag/delete", () => {
  it("selects a state on click", async () => {
    const { container, ctx } = await setup();
    ctx.setTool("select");
    container.querySelector('circle[data-state-id="2"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ctx.selection).toEqual({ kind: "state", id: 2 });
  });

  it("commits a drag as a single MoveState op on mouseup", async () => {
    const { container, client, ctx } = await setup();
    ctx.setTool("select");
    const circle = container.querySelector('circle[data-state-id="2"]');
    circle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 0, clientY: 0 }));
    container
      .querySelector(".diagram-canvas")
      .dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 50, clientY: 0 }));
    container.querySelector(".diagram-canvas").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    expect(client.pdaApply).toHaveBeenCalledWith([{ op: "MoveState", id: 2, x: 150, y: 10 }]);
  });

  it("deletes a state via RemoveState", async () => {
    const { container, client, ctx } = await setup();
    ctx.setTool("delete");
    container.querySelector('circle[data-state-id="2"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(client.pdaApply).toHaveBeenCalledWith([{ op: "RemoveState", id: 2 }]);
  });

  it("deletes a transition via RemoveTransition, by its own id", async () => {
    const { container, client, ctx } = await setup();
    ctx.setTool("delete");
    const hit = container.querySelector('.edge-hit[data-transition-id="1"]');
    hit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(client.pdaApply).toHaveBeenCalledWith([{ op: "RemoveTransition", id: 1 }]);
  });
});

describe("PdaDiagramView create-transition (three sequential prompts)", () => {
  it("prompts input, pop, push in sequence and applies an AddTransition op on a brand new pair", async () => {
    const promptInput = vi.fn().mockResolvedValue("b");
    const promptPop = vi.fn().mockResolvedValue("Z");
    const promptPush = vi.fn().mockResolvedValue("A Z");
    const { container, client, ctx, view } = await setup(
      {
        revision: 1,
        states: [
          { id: 1, label: "q0", x: 10, y: 10, initial: true, accepting: false },
          { id: 2, label: "q1", x: 100, y: 10, initial: false, accepting: false },
        ],
        transitions: [],
        derived: { input_alphabet: [], stack_alphabet: [], deterministic: true, unreachable: [] },
      },
      { promptInput, promptPop, promptPush },
    );
    ctx.setTool("create-transition");

    container.querySelector('circle[data-state-id="1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container.querySelector('circle[data-state-id="2"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await view._lastEditPromise;

    expect(promptInput).toHaveBeenCalledWith("");
    expect(promptPop).toHaveBeenCalledWith("");
    expect(promptPush).toHaveBeenCalledWith("");
    expect(client.pdaApply).toHaveBeenCalledWith([{ op: "AddTransition", from: 1, to: 2, input: "b", pop: ["Z"], push: ["A", "Z"] }]);
  });

  it("adds a SECOND transition between the same pair as a distinct AddTransition, not merged into the first", async () => {
    const promptInput = vi.fn().mockResolvedValue("b");
    const promptPop = vi.fn().mockResolvedValue("");
    const promptPush = vi.fn().mockResolvedValue("");
    const { container, client, ctx, view } = await setup(twoStateSnapshot(), { promptInput, promptPop, promptPush });
    ctx.setTool("create-transition");

    container.querySelector('circle[data-state-id="1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container.querySelector('circle[data-state-id="2"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await view._lastEditPromise;

    expect(client.pdaApply).toHaveBeenCalledWith([{ op: "AddTransition", from: 1, to: 2, input: "b", pop: [], push: [] }]);
  });

  it("does nothing when the input prompt is cancelled", async () => {
    const promptInput = vi.fn().mockResolvedValue(null);
    const { container, client, ctx, view } = await setup(twoStateSnapshot(), { promptInput });
    ctx.setTool("create-transition");

    container.querySelector('circle[data-state-id="1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container.querySelector('circle[data-state-id="2"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await view._lastEditPromise;

    expect(client.pdaApply).not.toHaveBeenCalled();
  });

  it("does nothing when the pop prompt (the second of three) is cancelled, after the input prompt already ran", async () => {
    const promptInput = vi.fn().mockResolvedValue("b");
    const promptPop = vi.fn().mockResolvedValue(null);
    const { container, client, ctx, view } = await setup(twoStateSnapshot(), { promptInput, promptPop });
    ctx.setTool("create-transition");

    container.querySelector('circle[data-state-id="1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container.querySelector('circle[data-state-id="2"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await view._lastEditPromise;

    expect(client.pdaApply).not.toHaveBeenCalled();
  });

  it("marks the chosen source with .pending-edge-source until the target is picked", async () => {
    const { container, ctx } = await setup();
    ctx.setTool("create-transition");
    container.querySelector('circle[data-state-id="1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(container.querySelector('circle[data-state-id="1"]').classList.contains("pending-edge-source")).toBe(true);
  });
});

describe("PdaDiagramView keyboard dispatch (pdaRegistry.js)", () => {
  it("V/S/T/D switch tools, same as the toolbar buttons", async () => {
    const { container, ctx } = await setup();
    const svg = container.querySelector(".diagram-canvas");
    svg.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
    expect(ctx.activeTool).toBe("create-state");
  });

  it("Delete removes the current selection", async () => {
    const { container, client, ctx } = await setup();
    ctx.setSelection({ kind: "state", id: 2 });
    container.querySelector(".diagram-canvas").dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(client.pdaApply).toHaveBeenCalledWith([{ op: "RemoveState", id: 2 }]);
  });

  it("Ctrl+Z undoes", async () => {
    const { container, client } = await setup();
    container
      .querySelector(".diagram-canvas")
      .dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    expect(client.pdaUndo).toHaveBeenCalled();
  });
});

describe("PdaDiagramView context menu", () => {
  afterEach(() => {
    document.querySelector(".context-menu")?.remove();
  });

  it("right-click on a state selects it and shows rename/mark-initial/toggle-accepting/delete", async () => {
    const { container, ctx } = await setup();
    const circle = container.querySelector('circle[data-state-id="2"]');
    circle.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));

    expect(ctx.selection).toEqual({ kind: "state", id: 2 });
    const items = [...document.querySelectorAll(".context-menu-item")].map((i) => i.dataset.action);
    expect(items).toEqual(["state.rename", "state.markInitial", "state.toggleAccepting", "edit.deleteSelection"]);
  });

  it("right-click on a transition selects it and shows edit/delete only", async () => {
    const { container, ctx } = await setup();
    const hit = container.querySelector('.edge-hit[data-transition-id="1"]');
    hit.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));

    expect(ctx.selection).toEqual({ kind: "transition", id: 1 });
    const items = [...document.querySelectorAll(".context-menu-item")].map((i) => i.dataset.action);
    expect(items).toEqual(["transition.edit", "edit.deleteSelection"]);
  });

  it("clicking a context-menu item runs the registry action and closes the menu", async () => {
    const { container, client, ctx } = await setup();
    ctx.setSelection({ kind: "state", id: 2 });
    const circle = container.querySelector('circle[data-state-id="2"]');
    circle.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));

    document.querySelector('.context-menu-item[data-action="state.markInitial"]').click();

    expect(client.pdaApply).toHaveBeenCalledWith([{ op: "SetInitial", id: 2 }]);
    expect(document.querySelector(".context-menu")).toBeNull();
  });
});

describe("PdaDiagramView rename", () => {
  it("double-click on a state prompts and renames via ctx.renameState", async () => {
    const promptLabel = vi.fn().mockResolvedValue("nuevo");
    const renameState = vi.fn().mockResolvedValue(true);
    const { container, view } = await setup(twoStateSnapshot(), { promptLabel, renameState });
    container.querySelector('circle[data-state-id="1"]').dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await view._lastEditPromise;
    expect(renameState).toHaveBeenCalledWith(1, "nuevo");
  });
});

describe("PdaDiagramView transition.edit", () => {
  it("double-click on a transition arc runs transition.edit, pre-filled with its current fields", async () => {
    const promptInput = vi.fn().mockResolvedValue("c");
    const promptPop = vi.fn().mockResolvedValue("Z");
    const promptPush = vi.fn().mockResolvedValue("A Z");
    const { container, client, view } = await setup(twoStateSnapshot(), { promptInput, promptPop, promptPush });

    container.querySelector('.edge-hit[data-transition-id="1"]').dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await view._lastEditPromise;

    expect(promptInput).toHaveBeenCalledWith("a");
    expect(promptPop).toHaveBeenCalledWith("Z");
    expect(promptPush).toHaveBeenCalledWith("A Z");
    expect(client.pdaApply).toHaveBeenCalledWith([{ op: "EditTransition", id: 1, input: "c", pop: ["Z"], push: ["A", "Z"] }]);
  });
});

describe("PdaDiagramView pan/zoom", () => {
  it("zoomIn shrinks the viewBox around its center", async () => {
    const { view } = await setup();
    view.viewport.zoomIn();
    const [, , w, h] = view.svg.getAttribute("viewBox").split(" ").map(Number);
    expect(w).toBeCloseTo(600 / 1.2);
    expect(h).toBeCloseTo(400 / 1.2);
  });

  it("reset restores the base 600x400 viewBox", async () => {
    const { view } = await setup();
    view.viewport.zoomIn();
    view.viewport.reset();
    expect(view.svg.getAttribute("viewBox")).toBe("0 0 600 400");
  });
});

describe("PdaDiagramView Abrir/Guardar", () => {
  it("clicking Abrir calls ctx.openFile", async () => {
    const openFile = vi.fn().mockResolvedValue(undefined);
    const { container, view } = await setup(twoStateSnapshot(), { openFile });
    container.querySelector(".canvas-file-btn").click();
    await view._lastFilePromise;
    expect(openFile).toHaveBeenCalled();
  });

  it("clicking Guardar calls ctx.saveFile", async () => {
    const saveFile = vi.fn().mockResolvedValue(undefined);
    const { container, view } = await setup(twoStateSnapshot(), { saveFile });
    container.querySelectorAll(".canvas-file-btn")[1].click();
    await view._lastFilePromise;
    expect(saveFile).toHaveBeenCalled();
  });
});
