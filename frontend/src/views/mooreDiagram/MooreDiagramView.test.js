import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MooreDocStore } from "../../store/MooreDocStore.js";
import { MooreContext } from "../../commands/MooreContext.js";
import { MooreDiagramView } from "./MooreDiagramView.js";

function twoStateSnapshot() {
  return {
    revision: 1,
    states: [
      { id: 1, label: "q0", x: 10, y: 10, initial: true, output: "even" },
      { id: 2, label: "q1", x: 100, y: 10, output: null },
    ],
    edges: [{ from: 1, to: 2, inputs: ["a"] }],
    derived: { input_alphabet: ["a"], output_alphabet: ["even"], deterministic: true, unreachable: [] },
  };
}

async function setup(snapshot = twoStateSnapshot(), hooks = {}) {
  const client = {
    mooreSnapshot: vi.fn().mockResolvedValue(snapshot),
    mooreApply: vi.fn().mockResolvedValue({ revision: snapshot.revision + 1, patches: [], derived: snapshot.derived }),
    mooreUndo: vi.fn(),
    mooreRedo: vi.fn(),
  };
  const docStore = new MooreDocStore(client);
  await docStore.load();
  const ctx = new MooreContext(docStore, hooks);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new MooreDiagramView(container, docStore, ctx);
  return { client, docStore, ctx, container, view };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("MooreDiagramView rendering", () => {
  it("renders a circle per state and no accepting double-circle (Moore has no accepting states)", async () => {
    const { container } = await setup();
    expect(container.querySelectorAll("circle[data-state-id]")).toHaveLength(2);
    expect(container.querySelector(".state-accepting-ring")).toBeNull();
  });

  it("renders the initial-state arrow only for the initial state", async () => {
    const { container } = await setup();
    expect(container.querySelectorAll(".initial-arrow")).toHaveLength(1);
    expect(container.querySelector('circle[data-state-id="1"]').classList.contains("initial")).toBe(true);
  });

  it("shows plain input symbols as the edge label, no output pairing", async () => {
    const { container } = await setup();
    const labels = [...container.querySelectorAll(".edge-label")].map((l) => l.textContent);
    expect(labels).toContain("a");
  });

  it("renders an output sub-label only for a state that has output set", async () => {
    const { container } = await setup();
    const outputLabels = [...container.querySelectorAll(".state-output-label")].map((l) => l.textContent);
    expect(outputLabels).toEqual(["/ even"]);
  });

  it("the status bar reports Moore/determinism/state/alphabet/transition counts", async () => {
    const { container } = await setup();
    expect(container.querySelector(".status-bar").textContent).toBe("Moore · determinista · Q=2 · Σ=1 · δ=1");
  });
});

describe("MooreDiagramView create-state (coordinate scaling)", () => {
  it("creates a state at the scaled click position, not the raw client offset", async () => {
    const { container, client, ctx } = await setup({
      revision: 1,
      states: [],
      edges: [],
      derived: { input_alphabet: [], output_alphabet: [], deterministic: true, unreachable: [] },
    });
    const svg = container.querySelector(".diagram-canvas");
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 300, height: 200 });
    ctx.setTool("create-state");

    svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 150, clientY: 100 }));

    expect(client.mooreApply).toHaveBeenCalledWith([{ op: "AddState", label: "q0", x: 300, y: 200 }]);
  });
});

describe("MooreDiagramView select/drag/delete", () => {
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

    expect(client.mooreApply).toHaveBeenCalledWith([{ op: "MoveState", id: 2, x: 150, y: 10 }]);
  });

  it("deletes a state via RemoveState", async () => {
    const { container, client, ctx } = await setup();
    ctx.setTool("delete");
    container.querySelector('circle[data-state-id="2"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(client.mooreApply).toHaveBeenCalledWith([{ op: "RemoveState", id: 2 }]);
  });

  it("deletes an edge by sending an empty SetTransitions with inputs, not entries", async () => {
    const { container, client, ctx } = await setup();
    ctx.setTool("delete");
    const hit = container.querySelector('.edge-hit[data-edge="1:2"]');
    hit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(client.mooreApply).toHaveBeenCalledWith([{ op: "SetTransitions", from: 1, to: 2, inputs: [] }]);
  });
});

describe("MooreDiagramView create-transition", () => {
  it("prompts once for a single input symbol and applies a SetTransitions op on a brand new edge", async () => {
    const promptInput = vi.fn().mockResolvedValue("b");
    const { container, client, ctx, view } = await setup(
      {
        revision: 1,
        states: [
          { id: 1, label: "q0", x: 10, y: 10, initial: true, output: null },
          { id: 2, label: "q1", x: 100, y: 10, output: null },
        ],
        edges: [],
        derived: { input_alphabet: [], output_alphabet: [], deterministic: true, unreachable: [] },
      },
      { promptInput },
    );
    ctx.setTool("create-transition");

    container.querySelector('circle[data-state-id="1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container.querySelector('circle[data-state-id="2"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await view._lastEditPromise;

    expect(promptInput).toHaveBeenCalledWith("");
    expect(client.mooreApply).toHaveBeenCalledWith([{ op: "SetTransitions", from: 1, to: 2, inputs: ["b"] }]);
  });

  it("merges into an existing edge's inputs, keeping the prior symbol", async () => {
    const promptInput = vi.fn().mockResolvedValue("c");
    const { container, client, ctx, view } = await setup(twoStateSnapshot(), { promptInput });
    ctx.setTool("create-transition");

    container.querySelector('circle[data-state-id="1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container.querySelector('circle[data-state-id="2"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await view._lastEditPromise;

    expect(promptInput).toHaveBeenCalledWith("a");
    expect(client.mooreApply).toHaveBeenCalledWith([{ op: "SetTransitions", from: 1, to: 2, inputs: ["a", "c"] }]);
  });

  it("does nothing on a cancelled or malformed prompt", async () => {
    const promptInput = vi.fn().mockResolvedValue(null);
    const { container, client, ctx, view } = await setup(twoStateSnapshot(), { promptInput });
    ctx.setTool("create-transition");

    container.querySelector('circle[data-state-id="1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container.querySelector('circle[data-state-id="2"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await view._lastEditPromise;

    expect(client.mooreApply).not.toHaveBeenCalled();
  });

  it("marks the chosen source with .pending-edge-source until the target is picked", async () => {
    const { container, ctx } = await setup();
    ctx.setTool("create-transition");
    container.querySelector('circle[data-state-id="1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(
      container.querySelector('circle[data-state-id="1"]').classList.contains("pending-edge-source"),
    ).toBe(true);
  });
});

describe("MooreDiagramView keyboard dispatch (mooreRegistry.js)", () => {
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
    expect(client.mooreApply).toHaveBeenCalledWith([{ op: "RemoveState", id: 2 }]);
  });

  it("Ctrl+Z undoes", async () => {
    const { container, client } = await setup();
    container
      .querySelector(".diagram-canvas")
      .dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    expect(client.mooreUndo).toHaveBeenCalled();
  });
});

describe("MooreDiagramView context menu", () => {
  afterEach(() => {
    document.querySelector(".context-menu")?.remove();
  });

  it("right-click on a state selects it and shows rename/mark-initial/set-output/delete", async () => {
    const { container, ctx } = await setup();
    const circle = container.querySelector('circle[data-state-id="2"]');
    circle.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));

    expect(ctx.selection).toEqual({ kind: "state", id: 2 });
    const items = [...document.querySelectorAll(".context-menu-item")].map((i) => i.dataset.action);
    expect(items).toEqual(["state.rename", "state.markInitial", "state.setOutput", "edit.deleteSelection"]);
  });

  it("clicking a context-menu item runs the registry action and closes the menu", async () => {
    const { container, client, ctx } = await setup();
    ctx.setSelection({ kind: "state", id: 2 });
    const circle = container.querySelector('circle[data-state-id="2"]');
    circle.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));

    document.querySelector('.context-menu-item[data-action="state.markInitial"]').click();

    expect(client.mooreApply).toHaveBeenCalledWith([{ op: "SetInitial", id: 2 }]);
    expect(document.querySelector(".context-menu")).toBeNull();
  });
});

describe("MooreDiagramView rename", () => {
  it("double-click prompts and renames via ctx.renameState", async () => {
    const promptLabel = vi.fn().mockResolvedValue("nuevo");
    const renameState = vi.fn().mockResolvedValue(true);
    const { container, view } = await setup(twoStateSnapshot(), { promptLabel, renameState });
    container.querySelector('circle[data-state-id="1"]').dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await view._lastEditPromise;
    expect(renameState).toHaveBeenCalledWith(1, "nuevo");
  });
});

describe("MooreDiagramView pan/zoom", () => {
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

describe("MooreDiagramView Abrir/Guardar", () => {
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
