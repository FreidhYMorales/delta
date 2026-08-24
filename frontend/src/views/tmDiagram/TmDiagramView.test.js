import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TmDocStore } from "../../store/TmDocStore.js";
import { TmContext } from "../../commands/TmContext.js";
import { TmDiagramView } from "./TmDiagramView.js";

function twoStateSnapshot() {
  return {
    revision: 1,
    states: [
      { id: 1, label: "q0", x: 10, y: 10, initial: true, accepting: false },
      { id: 2, label: "q1", x: 100, y: 10, initial: false, accepting: true },
    ],
    transitions: [{ id: 1, from: 1, to: 2, tapes: [{ read: "a", write: "b", direction: "R" }] }],
    derived: { alphabet: ["a", "b"], tape_count: 1, deterministic: true, unreachable: [] },
  };
}

async function setup(snapshot = twoStateSnapshot(), hooks = {}) {
  const client = {
    tmSnapshot: vi.fn().mockResolvedValue(snapshot),
    tmApply: vi.fn().mockResolvedValue({ revision: snapshot.revision + 1, patches: [], derived: snapshot.derived }),
    tmUndo: vi.fn(),
    tmRedo: vi.fn(),
  };
  const docStore = new TmDocStore(client);
  await docStore.load();
  const ctx = new TmContext(docStore, hooks);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new TmDiagramView(container, docStore, ctx);
  return { client, docStore, ctx, container, view };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("TmDiagramView rendering", () => {
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

  it("renders the transition label as 'read ; write , direction', real JFLAP's own per-tape format", async () => {
    const { container } = await setup();
    const labels = [...container.querySelectorAll(".edge-label")].map((l) => l.textContent);
    expect(labels).toContain("a ; b , R");
  });

  it("joins a multi-tape transition's label with ' | '", async () => {
    const { container } = await setup({
      revision: 1,
      states: [
        { id: 1, label: "q0", x: 10, y: 10, initial: true, accepting: false },
        { id: 2, label: "q1", x: 100, y: 10, initial: false, accepting: false },
      ],
      transitions: [
        {
          id: 1,
          from: 1,
          to: 2,
          tapes: [
            { read: "a", write: "b", direction: "R" },
            { read: "c", write: "d", direction: "L" },
          ],
        },
      ],
      derived: { alphabet: ["a", "b", "c", "d"], tape_count: 2, deterministic: true, unreachable: [] },
    });
    const labels = [...container.querySelectorAll(".edge-label")].map((l) => l.textContent);
    expect(labels).toContain("a ; b , R | c ; d , L");
  });

  it("renders each transition arc keyed by data-transition-id, not data-edge", async () => {
    const { container } = await setup();
    expect(container.querySelector('path.edge[data-transition-id="1"]')).not.toBeNull();
  });

  it("the status bar reports TM/determinism/state/alphabet/tape-count/transition counts", async () => {
    const { container } = await setup();
    expect(container.querySelector(".status-bar").textContent).toBe("TM · determinista · Q=2 · Σ=2 · Cintas=1 · δ=1");
  });
});

describe("TmDiagramView multiple transitions between the same pair (fan-out, same invariant as PDA's)", () => {
  function twoTransitionsSnapshot() {
    return {
      revision: 1,
      states: [
        { id: 1, label: "q0", x: 10, y: 10, initial: true, accepting: false },
        { id: 2, label: "q1", x: 100, y: 10, initial: false, accepting: false },
      ],
      transitions: [
        { id: 1, from: 1, to: 2, tapes: [{ read: "a", write: "a", direction: "S" }] },
        { id: 2, from: 1, to: 2, tapes: [{ read: "b", write: "b", direction: "S" }] },
      ],
      derived: { alphabet: ["a", "b"], tape_count: 1, deterministic: true, unreachable: [] },
    };
  }

  it("renders both transitions as distinct, independently-addressable arcs with distinct labels", async () => {
    const { container } = await setup(twoTransitionsSnapshot());
    const arcs = container.querySelectorAll("path.edge[data-transition-id]");
    expect([...arcs].map((a) => a.dataset.transitionId).sort()).toEqual(["1", "2"]);

    const labels = [...container.querySelectorAll(".edge-label")].map((l) => l.textContent);
    expect(labels).toContain("a ; a , S");
    expect(labels).toContain("b ; b , S");
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
    expect(client.tmApply).toHaveBeenCalledWith([{ op: "RemoveTransition", id: 2 }]);
  });

  it("selecting one via click selects only that transition id, not the whole (from,to) pair", async () => {
    const { container, ctx } = await setup(twoTransitionsSnapshot());
    ctx.setTool("select");
    container.querySelector('path.edge-hit[data-transition-id="1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ctx.selection).toEqual({ kind: "transition", id: 1 });
  });
});

describe("TmDiagramView create-state (coordinate scaling)", () => {
  it("creates a state at the scaled click position, not the raw client offset", async () => {
    const { container, client, ctx } = await setup({
      revision: 1,
      states: [],
      transitions: [],
      derived: { alphabet: [], tape_count: 0, deterministic: true, unreachable: [] },
    });
    const svg = container.querySelector(".diagram-canvas");
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 300, height: 200 });
    ctx.setTool("create-state");

    svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 150, clientY: 100 }));

    expect(client.tmApply).toHaveBeenCalledWith([{ op: "AddState", label: "q0", x: 300, y: 200 }]);
  });
});

describe("TmDiagramView select/drag/delete", () => {
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

    expect(client.tmApply).toHaveBeenCalledWith([{ op: "MoveState", id: 2, x: 150, y: 10 }]);
  });

  it("deletes a state via RemoveState", async () => {
    const { container, client, ctx } = await setup();
    ctx.setTool("delete");
    container.querySelector('circle[data-state-id="2"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(client.tmApply).toHaveBeenCalledWith([{ op: "RemoveState", id: 2 }]);
  });

  it("deletes a transition via RemoveTransition, by its own id", async () => {
    const { container, client, ctx } = await setup();
    ctx.setTool("delete");
    const hit = container.querySelector('.edge-hit[data-transition-id="1"]');
    hit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(client.tmApply).toHaveBeenCalledWith([{ op: "RemoveTransition", id: 1 }]);
  });
});

describe("TmDiagramView create-transition (one prompt per tape, count from effectiveTapeCount)", () => {
  it("runs exactly one tape prompt for a 1-tape (locked) document and applies AddTransition", async () => {
    const promptTape = vi.fn().mockResolvedValue("b ; c , R");
    const { container, client, ctx, view } = await setup(
      {
        revision: 1,
        states: [
          { id: 1, label: "q0", x: 10, y: 10, initial: true, accepting: false },
          { id: 2, label: "q1", x: 100, y: 10, initial: false, accepting: false },
        ],
        transitions: [],
        derived: { alphabet: [], tape_count: 1, deterministic: true, unreachable: [] },
      },
      { promptTape },
    );
    ctx.setTool("create-transition");

    container.querySelector('circle[data-state-id="1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container.querySelector('circle[data-state-id="2"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await view._lastEditPromise;

    expect(promptTape).toHaveBeenCalledTimes(1);
    expect(promptTape).toHaveBeenCalledWith(0, "");
    expect(client.tmApply).toHaveBeenCalledWith([
      { op: "AddTransition", from: 1, to: 2, tapes: [{ read: "b", write: "c", direction: "R" }] },
    ]);
  });

  it("runs 2 tape prompts when the document is not yet locked and ctx.tapeCountChoice is 2", async () => {
    const promptTape = vi.fn().mockImplementation(async (index) => (index === 0 ? "a ; a , S" : "b ; b , S"));
    const { container, client, ctx, view } = await setup(
      {
        revision: 1,
        states: [
          { id: 1, label: "q0", x: 10, y: 10, initial: true, accepting: false },
          { id: 2, label: "q1", x: 100, y: 10, initial: false, accepting: false },
        ],
        transitions: [],
        derived: { alphabet: [], tape_count: 0, deterministic: true, unreachable: [] },
      },
      { promptTape },
    );
    ctx.setTapeCountChoice(2);
    ctx.setTool("create-transition");

    container.querySelector('circle[data-state-id="1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container.querySelector('circle[data-state-id="2"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await view._lastEditPromise;

    expect(promptTape).toHaveBeenCalledTimes(2);
    expect(client.tmApply).toHaveBeenCalledWith([
      {
        op: "AddTransition",
        from: 1,
        to: 2,
        tapes: [
          { read: "a", write: "a", direction: "S" },
          { read: "b", write: "b", direction: "S" },
        ],
      },
    ]);
  });

  it("does nothing when the (only) tape prompt is cancelled", async () => {
    const promptTape = vi.fn().mockResolvedValue(null);
    const { container, client, ctx, view } = await setup(twoStateSnapshot(), { promptTape });
    ctx.setTool("create-transition");

    container.querySelector('circle[data-state-id="1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container.querySelector('circle[data-state-id="2"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await view._lastEditPromise;

    expect(client.tmApply).not.toHaveBeenCalled();
  });

  it("marks the chosen source with .pending-edge-source until the target is picked", async () => {
    const { container, ctx } = await setup();
    ctx.setTool("create-transition");
    container.querySelector('circle[data-state-id="1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(container.querySelector('circle[data-state-id="1"]').classList.contains("pending-edge-source")).toBe(true);
  });
});

describe("TmDiagramView keyboard dispatch (tmRegistry.js)", () => {
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
    expect(client.tmApply).toHaveBeenCalledWith([{ op: "RemoveState", id: 2 }]);
  });

  it("Ctrl+Z undoes", async () => {
    const { container, client } = await setup();
    container
      .querySelector(".diagram-canvas")
      .dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    expect(client.tmUndo).toHaveBeenCalled();
  });
});

describe("TmDiagramView context menu", () => {
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

    expect(client.tmApply).toHaveBeenCalledWith([{ op: "SetInitial", id: 2 }]);
    expect(document.querySelector(".context-menu")).toBeNull();
  });
});

describe("TmDiagramView rename", () => {
  it("double-click on a state prompts and renames via ctx.renameState", async () => {
    const promptLabel = vi.fn().mockResolvedValue("nuevo");
    const renameState = vi.fn().mockResolvedValue(true);
    const { container, view } = await setup(twoStateSnapshot(), { promptLabel, renameState });
    container.querySelector('circle[data-state-id="1"]').dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await view._lastEditPromise;
    expect(renameState).toHaveBeenCalledWith(1, "nuevo");
  });
});

describe("TmDiagramView transition.edit", () => {
  it("double-click on a transition arc runs transition.edit, pre-filled with its current tape", async () => {
    const promptTape = vi.fn().mockResolvedValue("c ; d , L");
    const { container, client, view } = await setup(twoStateSnapshot(), { promptTape });

    container.querySelector('.edge-hit[data-transition-id="1"]').dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await view._lastEditPromise;

    expect(promptTape).toHaveBeenCalledWith(0, "a ; b , R");
    expect(client.tmApply).toHaveBeenCalledWith([
      { op: "EditTransition", id: 1, tapes: [{ read: "c", write: "d", direction: "L" }] },
    ]);
  });
});

describe("TmDiagramView pan/zoom", () => {
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

describe("TmDiagramView Abrir/Guardar", () => {
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
