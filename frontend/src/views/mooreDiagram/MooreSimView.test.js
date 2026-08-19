import { beforeEach, describe, expect, it, vi } from "vitest";
import { MooreSimView } from "./MooreSimView.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

function setup(runSim) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new MooreSimView(container, runSim);
  return { container, view };
}

describe("MooreSimView", () => {
  it("splits the typed input on whitespace and calls runSim with the symbols", async () => {
    const runSim = vi.fn().mockResolvedValue({ outcome: "Completed", outputs: ["even"] });
    const { container, view } = setup(runSim);
    container.querySelector(".moore-sim-input").value = "1 0 1 1";
    container.querySelector(".btn-primary").click();
    await view._lastRunPromise;

    expect(runSim).toHaveBeenCalledWith(["1", "0", "1", "1"]);
  });

  it("shows just the initial output for the empty-input case (outputs has exactly 1 entry, never 0)", async () => {
    const runSim = vi.fn().mockResolvedValue({ outcome: "Completed", outputs: ["even"] });
    const { container, view } = setup(runSim);
    container.querySelector(".btn-primary").click();
    await view._lastRunPromise;

    expect(container.querySelector(".moore-sim-output").textContent).toBe("Salida: even");
    expect(container.querySelector(".moore-sim-output").classList.contains("moore-sim-error")).toBe(false);
  });

  it("joins outputs with the input symbol consumed between each pair (length input.length+1)", async () => {
    const runSim = vi.fn().mockResolvedValue({ outcome: "Completed", outputs: ["even", "odd", "odd", "even"] });
    const { container, view } = setup(runSim);
    container.querySelector(".moore-sim-input").value = "a b a";
    container.querySelector(".btn-primary").click();
    await view._lastRunPromise;

    expect(container.querySelector(".moore-sim-output").textContent).toBe(
      "Salida: even --[a]--> odd --[b]--> odd --[a]--> even",
    );
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
      expect(container.querySelector(".moore-sim-output").textContent).toBe(expected);
      expect(container.querySelector(".moore-sim-output").classList.contains("moore-sim-error")).toBe(true);
    }
  });
});
