import { beforeEach, describe, expect, it, vi } from "vitest";
import { PdaSimView } from "./PdaSimView.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

function setup(runSim) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new PdaSimView(container, runSim);
  return { container, view };
}

describe("PdaSimView", () => {
  it("splits the typed input on whitespace and calls runSim with the symbols and the selected accept mode", async () => {
    const runSim = vi.fn().mockResolvedValue({ outcome: "Accepted", steps: [] });
    const { container, view } = setup(runSim);
    container.querySelector(".pda-sim-input").value = "a a b b";
    container.querySelector(".btn-primary").click();
    await view._lastRunPromise;

    expect(runSim).toHaveBeenCalledWith(["a", "a", "b", "b"], "final");
  });

  it("defaults the accept-by selector to 'final' (Estado final)", () => {
    const { container } = setup(vi.fn());
    expect(container.querySelector(".pda-sim-accept-by").value).toBe("final");
  });

  it("passes 'empty' when the accept-by selector is switched to Pila vacía", async () => {
    const runSim = vi.fn().mockResolvedValue({ outcome: "Rejected", steps: [] });
    const { container, view } = setup(runSim);
    container.querySelector(".pda-sim-accept-by").value = "empty";
    container.querySelector(".btn-primary").click();
    await view._lastRunPromise;

    expect(runSim).toHaveBeenCalledWith([], "empty");
  });

  it("renders the outcome verdict and one line per step, showing every live branch's state and stack", async () => {
    const runSim = vi.fn().mockResolvedValue({
      outcome: "Accepted",
      steps: [
        [{ state: 1, stack: ["Z"] }],
        [{ state: 1, stack: ["A", "Z"] }, { state: 2, stack: ["Z"] }],
      ],
    });
    const { container, view } = setup(runSim);
    container.querySelector(".btn-primary").click();
    await view._lastRunPromise;

    const output = container.querySelector(".pda-sim-output");
    expect(output.classList.contains("pda-sim-error")).toBe(false);
    expect(output.querySelector(".pda-sim-verdict").textContent).toBe("Resultado: Aceptado");
    const steps = [...output.querySelectorAll(".pda-sim-steps li")].map((li) => li.textContent);
    expect(steps).toEqual(["Paso 0: #1 [Z]", "Paso 1: #1 [A Z] | #2 [Z]"]);
  });

  it("shows an empty stack as an em dash", async () => {
    const runSim = vi.fn().mockResolvedValue({ outcome: "Accepted", steps: [[{ state: 1, stack: [] }]] });
    const { container, view } = setup(runSim);
    container.querySelector(".btn-primary").click();
    await view._lastRunPromise;

    expect(container.querySelector(".pda-sim-steps li").textContent).toBe("Paso 0: #1 [—]");
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
      const { container, view } = setup(runSim);
      container.querySelector(".btn-primary").click();
      await view._lastRunPromise;
      const output = container.querySelector(".pda-sim-output");
      expect(output.querySelector(".pda-sim-verdict").textContent).toBe(`Resultado: ${label}`);
      expect(output.classList.contains("pda-sim-error")).toBe(true);
    }
  });
});
