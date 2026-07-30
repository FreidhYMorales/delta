import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../../store/DocStore.js";
import { ViewContext } from "../../commands/context.js";
import { TestingView } from "./TestingView.js";

function snapshot() {
  return {
    revision: 1,
    states: [
      { id: 1, label: "q0", x: 0, y: 0, initial: true, accepting: false },
      { id: 2, label: "q1", x: 50, y: 0, initial: false, accepting: true },
    ],
    edges: [{ from: 1, to: 2, epsilon: false, symbols: ["a"] }],
    derived: { classification: "Dfa", alphabet: ["a"], unreachable: [] },
  };
}

async function setup(hooks = {}) {
  const snap = snapshot();
  const client = {
    docSnapshot: vi.fn().mockResolvedValue(snap),
    docApply: vi.fn(),
    docUndo: vi.fn(),
    docRedo: vi.fn(),
  };
  const docStore = new DocStore(client);
  await docStore.load();
  const setActiveStates = vi.fn();
  const ctx = new ViewContext(docStore, { setActiveStates, ...hooks });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new TestingView(container, docStore, ctx);
  return { docStore, ctx, container, view, setActiveStates };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("TestingView (task 7.6)", () => {
  it("is collapsed by default", async () => {
    const { container } = await setup();
    const details = container.querySelector("details.testing-view");
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);
  });

  it("runs a single-string trace, tokenizing against the known alphabet, and shows the verdict", async () => {
    const simTrace = vi.fn().mockResolvedValue({
      outcome: "Accepted",
      steps: [[1], [2]],
    });
    const { container, view, setActiveStates } = await setup({ simTrace });

    container.querySelector(".testing-single-input").value = "a";
    container.querySelector(".testing-single button").click();
    await view._lastRunPromise;

    expect(simTrace).toHaveBeenCalledWith(["a"]);
    expect(container.querySelector(".testing-verdict").textContent).toBe("Accepted");
    expect(container.querySelector(".testing-step-label").textContent).toBe("Step 1/2");
    expect(setActiveStates).toHaveBeenLastCalledWith([1]);
  });

  it("steps forward/back through the trace with ◀ ▶, highlighting active states each time", async () => {
    const simTrace = vi.fn().mockResolvedValue({
      outcome: "Rejected",
      steps: [[1], [2], []],
    });
    const { container, view, setActiveStates } = await setup({ simTrace });

    container.querySelector(".testing-single-input").value = "aa";
    container.querySelector(".testing-single button").click();
    await view._lastRunPromise;
    setActiveStates.mockClear();

    container.querySelector(".testing-step-next").click();
    expect(container.querySelector(".testing-step-label").textContent).toBe("Step 2/3");
    expect(setActiveStates).toHaveBeenLastCalledWith([2]);

    container.querySelector(".testing-step-prev").click();
    expect(container.querySelector(".testing-step-label").textContent).toBe("Step 1/3");
    expect(setActiveStates).toHaveBeenLastCalledWith([1]);
  });

  it("clears diagram highlighting when the drawer is collapsed again", async () => {
    const { container, setActiveStates } = await setup();
    const details = container.querySelector("details.testing-view");
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    details.open = false;
    details.dispatchEvent(new Event("toggle"));
    expect(setActiveStates).toHaveBeenCalledWith([]);
  });

  it("runs a batch of strings (one per line) and renders a results table", async () => {
    const simBatch = vi.fn().mockResolvedValue([
      { outcome: "Accepted", steps: [] },
      { outcome: "Rejected", steps: [] },
    ]);
    const { container, view } = await setup({ simBatch });

    container.querySelector(".testing-batch-input").value = "a\nb";
    container.querySelector(".testing-batch button").click();
    await view._lastBatchPromise;

    expect(simBatch).toHaveBeenCalledWith([["a"], ["b"]]);
    const rows = [...container.querySelectorAll(".testing-batch-table tbody tr")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("a");
    expect(rows[0].textContent).toContain("Accepted");
    expect(rows[1].textContent).toContain("Rejected");
  });

  it("exposes openSingle/openBatch controls that reveal the drawer and focus the right input", async () => {
    const { container, view } = await setup();
    const details = container.querySelector("details.testing-view");
    expect(details.open).toBe(false);

    view.controls.openSingle();
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(container.querySelector(".testing-single-input"));

    details.open = false;
    view.controls.openBatch();
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(container.querySelector(".testing-batch-input"));
  });
});
