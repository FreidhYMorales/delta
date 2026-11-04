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

describe("PdaSimView step table", () => {
  const blockedWord = {
    outcome: "Stuck",
    steps: [],
    table: [
      { state: "q2", remaining: ["b", "a", "b"], stack: ["B", "B", "A", "Z"], next_state: "q3", next_stack: ["B", "A", "Z"] },
      { state: "q3", remaining: ["a", "b"], stack: ["B", "A", "Z"], next_state: null, next_stack: ["B", "A", "Z"] },
    ],
  };
  const acceptedWord = {
    outcome: "Accepted",
    steps: [],
    table: [{ state: "q0", remaining: [], stack: ["Z0"], next_state: "f", next_stack: [] }],
  };

  async function run(result) {
    const { container, view } = setup(vi.fn().mockResolvedValue(result));
    container.querySelector(".btn-primary").click();
    await view._lastRunPromise;
    return container;
  }

  function textOfRow(row) {
    return [...row.cells].map((cell) => cell.textContent);
  }

  it("shows the workbook's columns", async () => {
    const container = await run(blockedWord);

    expect(textOfRow(container.querySelector(".pda-step-table thead tr"))).toEqual([
      "Paso",
      "Estado Actual",
      "Cadena Restante",
      "Cima de Pila",
      "Siguiente Estado",
      "Nueva Pila",
    ]);
  });

  it("numbers the rows and joins the symbols, ending a blocked word in BLOQUEO", async () => {
    const container = await run(blockedWord);

    const rows = [...container.querySelectorAll(".pda-step-table tbody tr")].map(textOfRow);
    expect(rows.slice(0, 2)).toEqual([
      ["1", "q2", "bab", "BBAZ", "q3", "BAZ"],
      ["2", "q3", "ab", "BAZ", "BLOQUEO", "BAZ"],
    ]);
  });

  it("shows empty input and an empty stack as ε", async () => {
    const container = await run(acceptedWord);

    expect(textOfRow(container.querySelector(".pda-step-table tbody tr"))).toEqual(["1", "q0", "ε", "Z0", "f", "ε"]);
  });

  it("ends with the workbook's result row for an accepted word", async () => {
    const container = await run(acceptedWord);

    expect(textOfRow(container.querySelector(".pda-step-table tfoot tr"))).toEqual([
      "Resultado Final:",
      "CADENA ACEPTADA",
    ]);
  });

  it("ends with the workbook's result row for a blocked or rejected word", async () => {
    const stuck = await run(blockedWord);
    expect(textOfRow(stuck.querySelector(".pda-step-table tfoot tr"))).toEqual([
      "Resultado Final:",
      "CADENA NO ACEPTADA",
    ]);

    const rejected = await run({ ...blockedWord, outcome: "Rejected" });
    expect(textOfRow(rejected.querySelector(".pda-step-table tfoot tr"))).toEqual([
      "Resultado Final:",
      "CADENA NO ACEPTADA",
    ]);
  });

  it("shows no table when the run has no rows", async () => {
    const container = await run({ outcome: "TruncatedSteps", steps: [], table: [] });

    expect(container.querySelector(".pda-step-table")).toBeNull();
    expect(container.querySelector(".pda-sim-verdict").textContent).toBe("Resultado: Truncado (demasiados pasos)");
  });
});

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
