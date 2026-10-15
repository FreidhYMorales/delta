import { beforeEach, describe, expect, it, vi } from "vitest";
import { RegexDirectView } from "./RegexDirectView.js";
import { aOptionalB } from "./regexDirectFixtures.js";

function setup(regexToDfaDirect = vi.fn().mockResolvedValue(aOptionalB())) {
  const ctx = { regexToDfaDirect, createDfaTab: vi.fn().mockResolvedValue(undefined) };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new RegexDirectView(container, ctx);
  return { ctx, container, view };
}

async function compute(container, view, pattern = "a?b") {
  container.querySelector(".regex-direct-input").value = pattern;
  container.querySelector(".regex-direct-run").click();
  await view._lastRunPromise;
}

const cellTexts = (table) =>
  [...table.querySelectorAll("tr")].map((tr) => [...tr.children].map((cell) => cell.textContent));

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("RegexDirectView", () => {
  it("starts with just the input: no tree, no tables, nothing to create yet", () => {
    const { container } = setup();
    expect(container.querySelector(".regex-direct-input")).toBeTruthy();
    expect(container.querySelector(".conversion-step")).toBeNull();
    expect(container.querySelector("svg.syntax-tree")).toBeNull();
    expect(container.querySelector(".conversion-create").disabled).toBe(true);
  });

  it("computes from the typed regex and shows the tree plus one titled, copyable table per step", async () => {
    const { container, view, ctx } = setup();
    await compute(container, view);
    expect(ctx.regexToDfaDirect).toHaveBeenCalledWith("a?b");

    const titles = [...container.querySelectorAll(".conversion-step h3")].map((h) => h.textContent);
    expect(titles).toEqual([
      "Paso 1: árbol sintáctico aumentado con #",
      "Paso 2: hojas numeradas y anulables",
      "Paso 3-4: anulable, PrimeraPos y ÚltimaPos por nodo",
      "Paso 5: SiguientePos",
      "Paso 6: estados D",
      "Paso 7: transiciones D",
    ]);
    // Every table step has its copy button; the tree step has none.
    const tableSteps = [...container.querySelectorAll(".conversion-step")].filter((s) => s.querySelector("table"));
    expect(tableSteps).toHaveLength(5);
    for (const step of tableSteps) expect(step.querySelector("button[title='Copiar tabla']")).toBeTruthy();

    const tables = container.querySelectorAll(".conversion-step table");
    expect(cellTexts(tables[3])).toEqual([
      ["Conjunto", "Estado"],
      ["{1,2}", "→ A"],
      ["{2}", "B"],
      ["{3}", "C*"],
    ]);
  });

  it("draws every tree node, with each leaf's position and every node's PrimeraPos/ÚltimaPos", async () => {
    const { container, view } = setup();
    await compute(container, view);
    const svg = container.querySelector("svg.syntax-tree");
    expect(svg.querySelectorAll(".tree-node")).toHaveLength(6);
    const texts = [...svg.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toEqual(expect.arrayContaining(["a", "b", "#", "?", "·", "1", "2", "3", "{1,2}", "{3}"]));
    expect(svg.querySelectorAll(".tree-edge")).toHaveLength(5);
  });

  it("Enter in the input computes too", async () => {
    const { container, view, ctx } = setup();
    const input = container.querySelector(".regex-direct-input");
    input.value = "a?b";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await view._lastRunPromise;
    expect(ctx.regexToDfaDirect).toHaveBeenCalledWith("a?b");
  });

  it("shows the core's error and clears a previous result", async () => {
    const regexToDfaDirect = vi.fn().mockResolvedValueOnce(aOptionalB()).mockRejectedValueOnce("falta ')' para cerrar el grupo (posición 4)");
    const { container, view } = setup(regexToDfaDirect);
    await compute(container, view);
    await compute(container, view, "(a|b");
    expect(container.querySelector(".regex-direct-error").textContent).toContain("falta ')'");
    expect(container.querySelector(".conversion-step")).toBeNull();
    expect(container.querySelector(".conversion-create").disabled).toBe(true);
  });

  it("creates the resulting DFA in a new tab", async () => {
    const { container, view, ctx } = setup();
    await compute(container, view);
    container.querySelector(".conversion-create").click();
    expect(ctx.createDfaTab).toHaveBeenCalledWith({
      states: ["A", "B", "C"],
      initial: "A",
      accepting: ["C"],
      transitions: [
        { from: "A", symbol: "a", to: "B" },
        { from: "A", symbol: "b", to: "C" },
        { from: "B", symbol: "b", to: "C" },
      ],
    });
  });
});
