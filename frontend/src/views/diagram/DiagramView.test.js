import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../../store/DocStore.js";
import { ViewContext } from "../../commands/context.js";
import { findAction } from "../../commands/registry.js";
import { DiagramView } from "./DiagramView.js";

function twoStateSnapshot() {
  return {
    revision: 1,
    states: [
      { id: 1, label: "q0", x: 10, y: 10, initial: true, accepting: false },
      { id: 2, label: "q1", x: 100, y: 10, initial: false, accepting: true },
    ],
    edges: [{ from: 1, to: 2, epsilon: false, symbols: ["a"] }],
    derived: { classification: "Dfa", alphabet: ["a"], unreachable: [] },
  };
}

async function setup(snapshot = twoStateSnapshot()) {
  const client = {
    docSnapshot: vi.fn().mockResolvedValue(snapshot),
    docApply: vi.fn().mockResolvedValue({
      revision: snapshot.revision + 1,
      patches: [],
      derived: snapshot.derived,
    }),
    docUndo: vi.fn(),
    docRedo: vi.fn(),
  };
  const docStore = new DocStore(client);
  await docStore.load();
  const ctx = new ViewContext(docStore);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new DiagramView(container, docStore, ctx);
  return { client, docStore, ctx, container, view };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("DiagramView rendering (task 7.4)", () => {
  it("renders exactly the 4 core tools, sourced from the command registry", async () => {
    const { container } = await setup();
    const buttons = container.querySelectorAll(".toolbar [data-action]");
    expect([...buttons].map((b) => b.dataset.action)).toEqual([
      "tool.select",
      "tool.createState",
      "tool.createTransition",
      "tool.delete",
    ]);
  });

  it("renders one SVG circle per state and one line per edge", async () => {
    const { container } = await setup();
    expect(container.querySelectorAll("circle[data-state-id]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-edge]")).toHaveLength(1);
  });

  it("renders a status summary with classification and counts", async () => {
    const { container } = await setup();
    const status = container.querySelector(".status-bar");
    expect(status.textContent).toContain("DFA");
    expect(status.textContent).toContain("2"); // state count
  });

  it("re-renders when the DocStore changes", async () => {
    const { container, docStore } = await setup();
    docStore.loadSnapshot({
      revision: 2,
      states: [],
      edges: [],
      derived: { classification: "Dfa", alphabet: [], unreachable: [] },
    });
    expect(container.querySelectorAll("circle[data-state-id]")).toHaveLength(0);
  });
});

describe("DiagramView tool switching", () => {
  it("clicking a toolbar button dispatches the matching registry action and highlights it", async () => {
    const { container, ctx } = await setup();
    const createStateBtn = container.querySelector('[data-action="tool.createState"]');
    createStateBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(ctx.activeTool).toBe("create-state");
    expect(createStateBtn.classList.contains("active")).toBe(true);
    expect(
      container.querySelector('[data-action="tool.select"]').classList.contains("active"),
    ).toBe(false);
  });

  it("keyboard shortcuts V/S/T/D dispatch through the registry, not a parallel key map", async () => {
    const { container, ctx } = await setup();
    const svg = container.querySelector("svg");

    svg.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
    expect(ctx.activeTool).toBe("create-state");

    svg.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    expect(ctx.activeTool).toBe("create-transition");

    svg.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));
    expect(ctx.activeTool).toBe("delete");

    svg.dispatchEvent(new KeyboardEvent("keydown", { key: "v", bubbles: true }));
    expect(ctx.activeTool).toBe("select");
  });
});

describe("DiagramView selection (select tool)", () => {
  it("clicking a state circle selects it and updates the inspector", async () => {
    const { container, ctx } = await setup();
    const circle = container.querySelector('circle[data-state-id="2"]');
    circle.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(ctx.selection).toEqual({ kind: "state", id: 2 });
    expect(container.querySelector(".selection-inspector").textContent).toContain("q1");
  });

  it("clicking empty canvas clears the selection", async () => {
    const { container, ctx } = await setup();
    ctx.setSelection({ kind: "state", id: 1 });
    const svg = container.querySelector("svg");
    svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 500, clientY: 500 }));

    expect(ctx.selection).toBeNull();
  });
});

describe("DiagramView drag-to-move (select tool, bug 1)", () => {
  it("dragging a state circle updates its position live and commits a single MoveState on release", async () => {
    const { container, client, docStore } = await setup();
    const circle = container.querySelector('circle[data-state-id="1"]');

    circle.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10 }),
    );
    container
      .querySelector("svg")
      .dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 60, clientY: 40 }));

    // Live local update during the drag, before release.
    expect(docStore.getState(1).x).toBe(60);
    expect(docStore.getState(1).y).toBe(40);
    expect(client.docApply).not.toHaveBeenCalled();

    container
      .querySelector("svg")
      .dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 60, clientY: 40 }));

    expect(client.docApply).toHaveBeenCalledWith([{ op: "MoveState", id: 1, x: 60, y: 40 }]);
  });

  it("does not commit a MoveState when the pointer never moves", async () => {
    const { container, client } = await setup();
    const circle = container.querySelector('circle[data-state-id="1"]');
    const svg = container.querySelector("svg");

    circle.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10 }),
    );
    svg.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 10, clientY: 10 }));

    expect(client.docApply).not.toHaveBeenCalled();
  });

  it("does not drag when a non-select tool is active", async () => {
    const { container, ctx, client, docStore } = await setup();
    ctx.setTool("delete");
    const circle = container.querySelector('circle[data-state-id="1"]');
    const svg = container.querySelector("svg");

    circle.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10 }),
    );
    svg.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 60, clientY: 40 }));
    svg.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 60, clientY: 40 }));

    expect(docStore.getState(1).x).toBe(10);
    expect(client.docApply).not.toHaveBeenCalled();
  });
});

describe("DiagramView state context menu (bug 3)", () => {
  it("right-clicking a state selects it, suppresses the native menu, and lists registry actions", async () => {
    const { container, ctx } = await setup();
    const circle = container.querySelector('circle[data-state-id="1"]');
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 50,
      clientY: 60,
    });
    const preventDefault = vi.spyOn(event, "preventDefault");
    circle.dispatchEvent(event);

    expect(preventDefault).toHaveBeenCalled();
    expect(ctx.selection).toEqual({ kind: "state", id: 1 });

    const menu = document.querySelector(".context-menu");
    expect(menu).not.toBeNull();
    const itemIds = [...menu.querySelectorAll("[data-action]")].map((el) => el.dataset.action);
    expect(itemIds).toEqual(
      expect.arrayContaining([
        "state.rename",
        "state.markInitial",
        "state.toggleAccepting",
        "edit.deleteSelection",
      ]),
    );
  });

  it("clicking a context menu item runs the matching registry action and closes the menu", async () => {
    const { container, client } = await setup();
    const circle = container.querySelector('circle[data-state-id="1"]');
    circle.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }),
    );

    document
      .querySelector('.context-menu [data-action="state.markInitial"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(client.docApply).toHaveBeenCalledWith([{ op: "SetInitial", id: 1 }]);
    expect(document.querySelector(".context-menu")).toBeNull();
  });

  it("dismisses the context menu on Escape", async () => {
    const { container } = await setup();
    const circle = container.querySelector('circle[data-state-id="1"]');
    circle.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }),
    );
    expect(document.querySelector(".context-menu")).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(document.querySelector(".context-menu")).toBeNull();
  });

  it("dismisses the context menu when clicking elsewhere", async () => {
    const { container } = await setup();
    const circle = container.querySelector('circle[data-state-id="1"]');
    circle.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }),
    );
    expect(document.querySelector(".context-menu")).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(document.querySelector(".context-menu")).toBeNull();
  });
});

describe("DiagramView create-state tool", () => {
  it("clicking empty canvas creates a state at the click position with the next free label", async () => {
    const { container, ctx, client } = await setup();
    ctx.setTool("create-state");
    const svg = container.querySelector("svg");
    svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 42, clientY: 24 }));

    expect(client.docApply).toHaveBeenCalledWith([
      { op: "AddState", label: "q2", x: 42, y: 24 },
    ]);
  });
});

describe("DiagramView delete tool", () => {
  it("clicking a state removes it", async () => {
    const { container, ctx, client } = await setup();
    ctx.setTool("delete");
    container
      .querySelector('circle[data-state-id="1"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(client.docApply).toHaveBeenCalledWith([{ op: "RemoveState", id: 1 }]);
  });
});

describe("DiagramView viewport (view.zoomIn/zoomOut/reset/fitToWindow)", () => {
  it("exposes a viewport controller that changes the SVG viewBox", async () => {
    const { container, view } = await setup();
    const svg = container.querySelector("svg");
    const initialViewBox = svg.getAttribute("viewBox");

    view.viewport.zoomIn();
    expect(svg.getAttribute("viewBox")).not.toBe(initialViewBox);

    view.viewport.reset();
    expect(svg.getAttribute("viewBox")).toBe(initialViewBox);
  });

  it("registry view.zoomIn/zoomOut/reset/fitToWindow actions call the viewport controller once wired via ctx", async () => {
    const { view, ctx } = await setup();
    ctx.viewport = view.viewport;
    const spy = vi.spyOn(view.viewport, "fitToWindow");
    findAction("view.fitToWindow").run(ctx);
    expect(spy).toHaveBeenCalled();
  });
});

describe("DiagramView create-transition tool", () => {
  it("clicking a from-state then a to-state creates an edge using the prompted symbol", async () => {
    const promptSymbol = vi.fn().mockReturnValue("z");
    const snapshot = twoStateSnapshot();
    const client = {
      docSnapshot: vi.fn().mockResolvedValue(snapshot),
      docApply: vi.fn().mockResolvedValue({
        revision: snapshot.revision + 1,
        patches: [],
        derived: snapshot.derived,
      }),
      docUndo: vi.fn(),
      docRedo: vi.fn(),
    };
    const docStore = new DocStore(client);
    await docStore.load();
    const ctx = new ViewContext(docStore, { promptSymbol });
    const container = document.createElement("div");
    new DiagramView(container, docStore, ctx);

    ctx.setTool("create-transition");
    // No pre-existing edge from q1(2) -> q0(1) in the fixture (only 1->2
    // exists), so this exercises a brand new edge rather than a merge.
    container
      .querySelector('circle[data-state-id="2"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container
      .querySelector('circle[data-state-id="1"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(promptSymbol).toHaveBeenCalled();
    expect(client.docApply).toHaveBeenCalledWith([
      { op: "SetEdge", from: 2, to: 1, epsilon: false, symbols: ["z"] },
    ]);
  });
});
