import { beforeEach, describe, expect, it, vi } from "vitest";
import { TmSimView } from "./TmSimView.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

function fakeDocStore(tape_count = 0) {
  const listeners = new Set();
  return {
    derived: { alphabet: [], tape_count, deterministic: true, unreachable: [] },
    subscribe: vi.fn((l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    }),
    _notify() {
      for (const l of listeners) l(this);
    },
  };
}

function fakeCtx(tapeCountChoice = 1) {
  const listeners = new Set();
  return {
    tapeCountChoice,
    subscribe: vi.fn((l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    }),
    setTapeCountChoice(n) {
      this.tapeCountChoice = n;
      for (const l of listeners) l(this);
    },
  };
}

function setup(docStore, ctx, runSim) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new TmSimView(container, docStore, ctx, runSim);
  return { container, view };
}

describe("TmSimView tape input fields", () => {
  it("renders exactly 1 tape field when the doc is unlocked and ctx.tapeCountChoice is 1 (the default)", () => {
    const { container } = setup(fakeDocStore(0), fakeCtx(1), vi.fn());
    expect(container.querySelectorAll(".tm-sim-input")).toHaveLength(1);
    expect(container.querySelector(".field-label").textContent).toBe("Cinta 1");
  });

  it("renders effectiveTapeCount fields when ctx.tapeCountChoice is higher, pre-lock", () => {
    const { container } = setup(fakeDocStore(0), fakeCtx(3), vi.fn());
    const inputs = container.querySelectorAll(".tm-sim-input");
    expect(inputs).toHaveLength(3);
  });

  it("renders docStore.derived.tape_count fields once locked, ignoring ctx.tapeCountChoice", () => {
    const { container } = setup(fakeDocStore(2), fakeCtx(5), vi.fn());
    expect(container.querySelectorAll(".tm-sim-input")).toHaveLength(2);
  });

  it("re-renders the field count when the tape-count choice changes pre-lock", () => {
    const docStore = fakeDocStore(0);
    const ctx = fakeCtx(1);
    const { container } = setup(docStore, ctx, vi.fn());
    expect(container.querySelectorAll(".tm-sim-input")).toHaveLength(1);

    ctx.setTapeCountChoice(3);
    expect(container.querySelectorAll(".tm-sim-input")).toHaveLength(3);
  });
});

describe("TmSimView run", () => {
  it("builds inputs: string[][] — one array per tape field, split on whitespace", async () => {
    const runSim = vi.fn().mockResolvedValue({ outcome: "Accepted", steps: [] });
    const { container, view } = setup(fakeDocStore(2), fakeCtx(1), runSim);

    const inputs = container.querySelectorAll(".tm-sim-input");
    inputs[0].value = "a a b";
    inputs[1].value = "x y";
    container.querySelector(".btn-primary").click();
    await view._lastRunPromise;

    expect(runSim).toHaveBeenCalledWith([["a", "a", "b"], ["x", "y"]], "final");
  });

  it("defaults the accept-by selector to 'final' (Estado final)", () => {
    const { container } = setup(fakeDocStore(1), fakeCtx(1), vi.fn());
    expect(container.querySelector(".tm-sim-accept-by").value).toBe("final");
  });

  it("passes 'halting' when the accept-by selector is switched to Detención", async () => {
    const runSim = vi.fn().mockResolvedValue({ outcome: "Rejected", steps: [] });
    const { container, view } = setup(fakeDocStore(1), fakeCtx(1), runSim);
    container.querySelector(".tm-sim-accept-by").value = "halting";
    container.querySelector(".btn-primary").click();
    await view._lastRunPromise;

    expect(runSim).toHaveBeenCalledWith([[]], "halting");
  });

  it("renders the outcome verdict and one line per step, formatting each config's tapes via formatTapeCells", async () => {
    const runSim = vi.fn().mockResolvedValue({
      outcome: "Accepted",
      steps: [
        [{ state: 1, tapes: [{ cells: { 0: "a" }, head: 0 }] }],
        [
          { state: 1, tapes: [{ cells: { 0: "a", 1: "b" }, head: 1 }] },
          { state: 2, tapes: [{ cells: {}, head: 0 }] },
        ],
      ],
    });
    const { container, view } = setup(fakeDocStore(1), fakeCtx(1), runSim);
    container.querySelector(".btn-primary").click();
    await view._lastRunPromise;

    const output = container.querySelector(".tm-sim-output");
    expect(output.classList.contains("tm-sim-error")).toBe(false);
    expect(output.querySelector(".tm-sim-verdict").textContent).toBe("Resultado: Aceptado");
    const steps = [...output.querySelectorAll(".tm-sim-steps li")].map((li) => li.textContent);
    expect(steps).toEqual([
      "Paso 0: #1 T0:[0=a] head@0",
      "Paso 1: #1 T0:[0=a, 1=b] head@1 | #2 T0:[—] head@0",
    ]);
  });

  it("flags a non-Accepted outcome as an error, with a Spanish label per outcome kind", async () => {
    const cases = [
      ["Rejected", "Rechazado"],
      ["Stuck", "Atascado (sin transición aplicable)"],
      ["TruncatedSteps", "Truncado (demasiados pasos)"],
      ["TruncatedConfigs", "Truncado (demasiadas configuraciones)"],
    ];
    for (const [outcome, label] of cases) {
      const runSim = vi.fn().mockResolvedValue({ outcome, steps: [] });
      const { container, view } = setup(fakeDocStore(1), fakeCtx(1), runSim);
      container.querySelector(".btn-primary").click();
      await view._lastRunPromise;
      const output = container.querySelector(".tm-sim-output");
      expect(output.querySelector(".tm-sim-verdict").textContent).toBe(`Resultado: ${label}`);
      expect(output.classList.contains("tm-sim-error")).toBe(true);
    }
  });
});
