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
  it("renders one SVG circle per state and one line per edge", async () => {
    const { container } = await setup();
    expect(container.querySelectorAll("circle[data-state-id]")).toHaveLength(2);
    expect(container.querySelectorAll(".edge[data-edge]")).toHaveLength(1);
  });

  it("offsets a straight edge's label off the line instead of sitting on top of it (bug: label sat exactly on the stroke)", async () => {
    const { container } = await setup();
    // Both states sit at y=10 (a horizontal line), so a label perpendicular
    // to it must move away in y — sitting "on the line" would keep y at 10.
    const label = container.querySelector(".edge-label");
    expect(Number(label.getAttribute("y"))).not.toBeCloseTo(10, 1);
  });

  it("renders a double-circle ring for an accepting state and an arrow stub for the initial state", async () => {
    const { container } = await setup();
    // Fixture: state 1 (q0) is initial, state 2 (q1) is accepting.
    expect(container.querySelectorAll(".state-accepting-ring")).toHaveLength(1);
    expect(container.querySelectorAll(".initial-arrow")).toHaveLength(1);
  });

  it("renders a wider invisible hit-path alongside each visible edge, for easier hover/click", async () => {
    const { container } = await setup();
    const hits = [...container.querySelectorAll(".edge-hit")];
    expect(hits).toHaveLength(1);
    expect(hits[0].dataset.edge).toBe("1:2");
  });

  it("renders a status summary with classification and counts", async () => {
    const { container } = await setup();
    const status = container.querySelector(".status-bar");
    expect(status.textContent).toContain("AFD");
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

  it("scales the drag delta by the viewBox/rendered-size ratio, so the state keeps tracking the cursor on a stretched canvas", async () => {
    const { container, docStore } = await setup();
    const circle = container.querySelector('circle[data-state-id="1"]');
    const svg = container.querySelector("svg");
    // Same 2x stretch as the create-state coordinate test: 100 screen
    // pixels of drag should move the state by 50 SVG units, not 100.
    svg.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 1200,
      height: 800,
      right: 1200,
      bottom: 800,
      x: 0,
      y: 0,
    });

    circle.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10 }),
    );
    svg.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 110, clientY: 60 }));

    expect(docStore.getState(1).x).toBe(60);
    expect(docStore.getState(1).y).toBe(35);
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

  it("scales the click position by the viewBox/rendered-size ratio when the canvas is stretched (bug: stretched .diagram-canvas ignored the ratio)", async () => {
    const { container, ctx, client } = await setup();
    ctx.setTool("create-state");
    const svg = container.querySelector("svg");
    // viewBox stays 600x400 (BASE_WIDTH/HEIGHT) but the element renders at
    // 1200x800 (e.g. `.diagram-canvas { width: 100% }` stretching it) -> a
    // screen pixel is worth 0.5 SVG units on each axis.
    svg.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 1200,
      height: 800,
      right: 1200,
      bottom: 800,
      x: 0,
      y: 0,
    });
    svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 400, clientY: 200 }));

    expect(client.docApply).toHaveBeenCalledWith([
      { op: "AddState", label: "q2", x: 200, y: 100 },
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

  it("mouse-wheel zoom keeps the point under the cursor in place, and zooms out on a positive deltaY", async () => {
    const { container } = await setup();
    const svg = container.querySelector("svg");
    const before = svg.getAttribute("viewBox");

    svg.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 300, clientY: 200, deltaY: 100 }),
    );

    const [, , w, h] = svg.getAttribute("viewBox").split(" ").map(Number);
    const [, , bw, bh] = before.split(" ").map(Number);
    expect(w).toBeGreaterThan(bw);
    expect(h).toBeGreaterThan(bh);
  });

  it("dragging empty canvas pans the viewport (free navigation) without touching any state", async () => {
    const { container, docStore, client } = await setup();
    const svg = container.querySelector("svg");
    const before = svg.getAttribute("viewBox");

    svg.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 100, clientY: 100 }));
    svg.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 150, clientY: 130 }));

    expect(svg.getAttribute("viewBox")).not.toBe(before);
    expect(docStore.getState(1).x).toBe(10); // unchanged — this was a pan, not a state drag

    svg.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 150, clientY: 130 }));
    expect(client.docApply).not.toHaveBeenCalled(); // panning never touches the document
  });

  it("does not pan while the create-state tool is active, so empty-canvas drags don't fight click-to-place", async () => {
    const { container, ctx } = await setup();
    ctx.setTool("create-state");
    const svg = container.querySelector("svg");
    const before = svg.getAttribute("viewBox");

    svg.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 100, clientY: 100 }));
    svg.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 150, clientY: 130 }));

    expect(svg.getAttribute("viewBox")).toBe(before);
  });

  it("toggles a .panning cursor class on the svg for the duration of a pan drag", async () => {
    const { container } = await setup();
    const svg = container.querySelector("svg");

    svg.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 100, clientY: 100 }));
    expect(svg.classList.contains("panning")).toBe(true);

    svg.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 100, clientY: 100 }));
    expect(svg.classList.contains("panning")).toBe(false);
  });

  it("toggles a .tool-create-state cursor class on the svg when that tool is active", async () => {
    const { container, ctx } = await setup();
    const svg = container.querySelector("svg");
    expect(svg.classList.contains("tool-create-state")).toBe(false);

    ctx.setTool("create-state");
    expect(svg.classList.contains("tool-create-state")).toBe(true);

    ctx.setTool("select");
    expect(svg.classList.contains("tool-create-state")).toBe(false);
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
    const view = new DiagramView(container, docStore, ctx);

    ctx.setTool("create-transition");
    // No pre-existing edge from q1(2) -> q0(1) in the fixture (only 1->2
    // exists), so this exercises a brand new edge rather than a merge.
    container
      .querySelector('circle[data-state-id="2"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container
      .querySelector('circle[data-state-id="1"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await view._lastEditPromise;

    expect(promptSymbol).toHaveBeenCalled();
    expect(client.docApply).toHaveBeenCalledWith([
      { op: "SetEdge", from: 2, to: 1, epsilon: false, symbols: ["z"] },
    ]);
  });

  it("promptSymbol resolving with \"\" (blank submitted) creates a real epsilon transition, not a no-op (reported bug: 'blank = epsilon' never actually fired)", async () => {
    const promptSymbol = vi.fn().mockReturnValue("");
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
    const view = new DiagramView(container, docStore, ctx);

    ctx.setTool("create-transition");
    container
      .querySelector('circle[data-state-id="2"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container
      .querySelector('circle[data-state-id="1"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await view._lastEditPromise;

    expect(client.docApply).toHaveBeenCalledWith([
      { op: "SetEdge", from: 2, to: 1, epsilon: true, symbols: [] },
    ]);
  });

  it("promptSymbol resolving with null (cancelled) does nothing", async () => {
    const promptSymbol = vi.fn().mockReturnValue(null);
    const { container, ctx, client } = await setup();

    ctx.setTool("create-transition");
    container
      .querySelector('circle[data-state-id="1"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    ctx.promptSymbol = promptSymbol;
    container
      .querySelector('circle[data-state-id="2"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(client.docApply).not.toHaveBeenCalled();
  });

  it("marks the clicked source state with .pending-edge-source until a target is picked", async () => {
    const { container, ctx } = await setup();
    ctx.setTool("create-transition");

    container
      .querySelector('circle[data-state-id="1"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(
      container.querySelector('circle[data-state-id="1"]').classList.contains("pending-edge-source"),
    ).toBe(true);
    expect(
      container.querySelector('circle[data-state-id="2"]').classList.contains("pending-edge-source"),
    ).toBe(false);
  });

  it("adds .awaiting-edge-target to the canvas once a source is picked, and clears it after the target click", async () => {
    const client = {
      docSnapshot: vi.fn().mockResolvedValue(twoStateSnapshot()),
      docApply: vi.fn().mockResolvedValue({ revision: 2, patches: [], derived: twoStateSnapshot().derived }),
      docUndo: vi.fn(),
      docRedo: vi.fn(),
    };
    const docStore = new DocStore(client);
    await docStore.load();
    const ctx = new ViewContext(docStore, { promptSymbol: vi.fn().mockReturnValue("z") });
    const container = document.createElement("div");
    const view = new DiagramView(container, docStore, ctx);
    ctx.setTool("create-transition");

    const svg = container.querySelector(".diagram-canvas");
    expect(svg.classList.contains("awaiting-edge-target")).toBe(false);

    container
      .querySelector('circle[data-state-id="1"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(svg.classList.contains("awaiting-edge-target")).toBe(true);

    container
      .querySelector('circle[data-state-id="2"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await view._lastEditPromise;
    expect(svg.classList.contains("awaiting-edge-target")).toBe(false);
  });

  it("clears the pending source and .awaiting-edge-target if the tool is switched away mid-pick", async () => {
    const { container, ctx } = await setup();
    ctx.setTool("create-transition");
    container
      .querySelector('circle[data-state-id="1"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    ctx.setTool("select");

    const svg = container.querySelector(".diagram-canvas");
    expect(svg.classList.contains("awaiting-edge-target")).toBe(false);
    expect(
      container.querySelector('circle[data-state-id="1"]').classList.contains("pending-edge-source"),
    ).toBe(false);
  });
});

describe("DiagramView unreachable states (task 7.8, spec cross-cutting)", () => {
  it("still renders an unreachable state on the diagram — never hidden or dropped", async () => {
    const { container } = await setup({
      revision: 1,
      states: [
        { id: 1, label: "q0", x: 10, y: 10, initial: true, accepting: false },
        { id: 2, label: "q1", x: 100, y: 10, initial: false, accepting: false },
      ],
      edges: [],
      derived: { classification: "Dfa", alphabet: [], unreachable: [2] },
    });
    // Both states are still present as real circles — q1 has no path from
    // q0 (no edges at all here) but is not filtered out of the diagram.
    expect(container.querySelectorAll("circle[data-state-id]")).toHaveLength(2);
  });

  it("marks an unreachable state's circle with the .unreachable CSS class, and only that one", async () => {
    const { container } = await setup({
      revision: 1,
      states: [
        { id: 1, label: "q0", x: 10, y: 10, initial: true, accepting: false },
        { id: 2, label: "q1", x: 100, y: 10, initial: false, accepting: false },
      ],
      edges: [],
      derived: { classification: "Dfa", alphabet: [], unreachable: [2] },
    });
    expect(
      container.querySelector('circle[data-state-id="1"]').classList.contains("unreachable"),
    ).toBe(false);
    expect(
      container.querySelector('circle[data-state-id="2"]').classList.contains("unreachable"),
    ).toBe(true);
  });

  it("the status bar count reflects derived.unreachable", async () => {
    const { container } = await setup({
      revision: 1,
      states: [
        { id: 1, label: "q0", x: 10, y: 10, initial: true, accepting: false },
        { id: 2, label: "q1", x: 100, y: 10, initial: false, accepting: false },
        { id: 3, label: "q2", x: 200, y: 10, initial: false, accepting: false },
      ],
      edges: [],
      derived: { classification: "Dfa", alphabet: [], unreachable: [2, 3] },
    });
    expect(container.querySelector(".status-bar").textContent).toContain("2 inalcanzable(s)");
  });
});

describe("DiagramView double-click rename (task 7.9: collisions are never silent)", () => {
  it("renames via ctx.renameState, not a raw docStore.apply", async () => {
    const promptLabel = vi.fn().mockResolvedValue("q1");
    const renameState = vi.fn().mockResolvedValue(true);
    const snapshot = twoStateSnapshot();
    const client = {
      docSnapshot: vi.fn().mockResolvedValue(snapshot),
      docApply: vi.fn(),
      docUndo: vi.fn(),
      docRedo: vi.fn(),
    };
    const docStore = new DocStore(client);
    await docStore.load();
    const ctx = new ViewContext(docStore, { promptLabel, renameState });
    const container = document.createElement("div");
    const view = new DiagramView(container, docStore, ctx);

    container
      .querySelector('circle[data-state-id="1"]')
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await view._lastEditPromise;

    expect(renameState).toHaveBeenCalledWith(1, "q1");
    expect(client.docApply).not.toHaveBeenCalled();
  });
});
