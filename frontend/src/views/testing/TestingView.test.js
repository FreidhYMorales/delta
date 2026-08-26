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

async function setup(hooks = {}, options = {}) {
  const snap = snapshot();
  const client = {
    docSnapshot: vi.fn().mockResolvedValue(snap),
    docApply: vi.fn(),
    docUndo: vi.fn(),
    docRedo: vi.fn(),
  };
  const docStore = new DocStore(client);
  await docStore.load();
  const ctx = new ViewContext(docStore, hooks);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new TestingView(container, docStore, ctx, options);
  return { docStore, ctx, container, view };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("TestingView (task 7.6)", () => {
  it("renders three tabs: Cadena, Lote, Resultados, with Cadena selected by default", async () => {
    const { container } = await setup();
    const tabs = [...container.querySelectorAll(".tab")].map((t) => t.textContent);
    expect(tabs).toEqual(["Cadena", "Lote", "Resultados"]);
    expect(container.querySelector(".tab.active").textContent).toBe("Cadena");
  });

  it("runs a single-string trace, tokenizing against the known alphabet, shows the verdict and full trace, and jumps to Resultados", async () => {
    const simTrace = vi.fn().mockResolvedValue({
      outcome: "Accepted",
      steps: [[1], [2]],
    });
    const { container, view } = await setup({ simTrace });

    container.querySelector(".testing-single-input").value = "a";
    container.querySelector(".testing-single button").click();
    await view._lastRunPromise;

    expect(simTrace).toHaveBeenCalledWith(["a"]);
    expect(container.querySelector(".testing-verdict").textContent).toBe("Accepted");
    expect(container.querySelector(".testing-verdict").classList.contains("accepted")).toBe(true);
    const steps = [...container.querySelectorAll(".trace-step")].map((s) => s.textContent);
    expect(steps).toEqual(["q0", "q1"]);
    expect(container.querySelector(".trace-step.hit").textContent).toBe("q1");
    expect(container.querySelector(".tab.active").textContent).toBe("Resultados");
  });

  it("runs a batch of strings (one per line), renders a results table, and jumps to Resultados", async () => {
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
    expect(container.querySelector(".tab.active").textContent).toBe("Resultados");
  });

  it("Resultados shows exactly one of empty-hint/single-trace/batch-table at a time (bug: batch leaves the Cadena hint visible)", async () => {
    const simTrace = vi.fn().mockResolvedValue({ outcome: "Accepted", steps: [[1]] });
    const simBatch = vi.fn().mockResolvedValue([{ outcome: "Accepted", steps: [] }]);
    const { container, view } = await setup({ simTrace, simBatch });

    expect(container.querySelector(".empty-hint").hidden).toBe(false);
    expect(container.querySelector(".testing-verdict").hidden).toBe(true);
    expect(container.querySelector(".testing-batch-table").hidden).toBe(true);

    container.querySelector(".testing-batch-input").value = "a";
    container.querySelector(".testing-batch button").click();
    await view._lastBatchPromise;

    expect(container.querySelector(".empty-hint").hidden).toBe(true);
    expect(container.querySelector(".testing-verdict").hidden).toBe(true);
    expect(container.querySelector(".trace-row").hidden).toBe(true);
    expect(container.querySelector(".testing-batch-table").hidden).toBe(false);

    container.querySelector(".testing-single-input").value = "a";
    container.querySelector(".testing-single button").click();
    await view._lastRunPromise;

    expect(container.querySelector(".empty-hint").hidden).toBe(true);
    expect(container.querySelector(".testing-verdict").hidden).toBe(false);
    expect(container.querySelector(".trace-row").hidden).toBe(false);
    expect(container.querySelector(".testing-batch-table").hidden).toBe(true);
  });

  it("exposes openSingle/openBatch controls that select the right tab and focus its input", async () => {
    const { container, view } = await setup();

    view.controls.openSingle();
    expect(container.querySelector(".tab.active").textContent).toBe("Cadena");
    expect(document.activeElement).toBe(container.querySelector(".testing-single-input"));

    view.controls.openBatch();
    expect(container.querySelector(".tab.active").textContent).toBe("Lote");
    expect(document.activeElement).toBe(container.querySelector(".testing-batch-input"));
  });

  it("re-clicking the active tab collapses the content and reports it via onCollapsedChange (main.js's panel-upper/panel-lower coordination)", async () => {
    const onCollapsedChange = vi.fn();
    const { container } = await setup({}, { onCollapsedChange });

    const activeTab = container.querySelector(".tab.active");
    activeTab.click();
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    expect(container.querySelector(".testing-view").classList.contains("tabs-collapsed")).toBe(true);

    activeTab.click();
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });
});
