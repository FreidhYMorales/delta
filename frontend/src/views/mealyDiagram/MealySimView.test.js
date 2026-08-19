import { beforeEach, describe, expect, it, vi } from "vitest";
import { MealySimView } from "./MealySimView.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

function setup(runSim) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new MealySimView(container, runSim);
  return { container, view };
}

describe("MealySimView", () => {
  it("splits the typed input on whitespace and calls runSim with the symbols", async () => {
    const runSim = vi.fn().mockResolvedValue({ outcome: "Completed", outputs: ["x"] });
    const { container, view } = setup(runSim);
    container.querySelector(".mealy-sim-input").value = "1 0 1 1";
    container.querySelector(".btn-primary").click();
    await view._lastRunPromise;

    expect(runSim).toHaveBeenCalledWith(["1", "0", "1", "1"]);
  });

  it("shows the output string on a completed run", async () => {
    const runSim = vi.fn().mockResolvedValue({ outcome: "Completed", outputs: ["1", "1", "0", "0"] });
    const { container, view } = setup(runSim);
    container.querySelector(".btn-primary").click();
    await view._lastRunPromise;

    expect(container.querySelector(".mealy-sim-output").textContent).toBe("Salida: 1 1 0 0");
    expect(container.querySelector(".mealy-sim-output").classList.contains("mealy-sim-error")).toBe(false);
  });

  it("shows a message for the empty-output case", async () => {
    const runSim = vi.fn().mockResolvedValue({ outcome: "Completed", outputs: [] });
    const { container, view } = setup(runSim);
    container.querySelector(".btn-primary").click();
    await view._lastRunPromise;

    expect(container.querySelector(".mealy-sim-output").textContent).toBe("Salida: (cadena vacía)");
  });

  it("shows a stuck message for NoTransition/Ambiguous/NoInitialState, flagged as an error", async () => {
    const cases = [
      [{ outcome: "NoInitialState" }, "Sin estado inicial."],
      [{ outcome: "NoTransition", at: 2 }, "Sin transición en la posición 2."],
      [{ outcome: "Ambiguous", at: 0 }, "Ambiguo (no determinista) en la posición 0."],
    ];
    for (const [outcome, expected] of cases) {
      const runSim = vi.fn().mockResolvedValue(outcome);
      const { container, view } = setup(runSim);
      container.querySelector(".btn-primary").click();
      await view._lastRunPromise;
      expect(container.querySelector(".mealy-sim-output").textContent).toBe(expected);
      expect(container.querySelector(".mealy-sim-output").classList.contains("mealy-sim-error")).toBe(true);
    }
  });
});
