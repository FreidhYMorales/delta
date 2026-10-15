import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../../store/DocStore.js";
import { AfnToAfdView } from "./AfnToAfdView.js";

// q0 -a-> q1 -ε-> q2 (accepting).
function snapshot({ withInitial = true } = {}) {
  return {
    revision: 1,
    states: [
      { id: 0, label: "q0", x: 0, y: 0, initial: withInitial, accepting: false },
      { id: 1, label: "q1", x: 100, y: 0, initial: false, accepting: false },
      { id: 2, label: "q2", x: 200, y: 0, initial: false, accepting: true },
    ],
    edges: [
      { from: 0, to: 1, epsilon: false, symbols: ["a"] },
      { from: 1, to: 2, epsilon: true, symbols: [] },
    ],
    derived: { classification: "Nfa", alphabet: ["a"], unreachable: [] },
  };
}

async function setup(snap = snapshot()) {
  const client = {
    docSnapshot: vi.fn().mockResolvedValue(snap),
    docApply: vi.fn(),
    docUndo: vi.fn(),
    docRedo: vi.fn(),
  };
  const docStore = new DocStore(client);
  await docStore.load();
  const ctx = { createDfaTab: vi.fn().mockResolvedValue(undefined) };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new AfnToAfdView(container, docStore, ctx);
  return { docStore, ctx, container, view };
}

const cellTexts = (table) =>
  [...table.querySelectorAll("tr")].map((tr) => [...tr.children].map((cell) => cell.textContent));

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("AfnToAfdView", () => {
  it("shows the three steps, each as a titled table with its own copy button", async () => {
    const { container } = await setup();
    const sections = [...container.querySelectorAll(".conversion-step")];
    expect(sections.map((s) => s.querySelector("h3").textContent)).toEqual([
      "Paso 1: clausuras ε",
      "Paso 2: tabla de transiciones del AFN-ε",
      "Paso 3: tabla de transiciones sin ε",
    ]);
    for (const section of sections) {
      expect(section.querySelector("table")).toBeTruthy();
      expect(section.querySelector("button[title='Copiar tabla']")).toBeTruthy();
    }
  });

  it("fills the tables from the current automaton", async () => {
    const { container } = await setup();
    const [closures, nfa, dfa] = container.querySelectorAll(".conversion-step table");
    expect(cellTexts(closures)).toEqual([
      ["Estados", "Clausuras ε"],
      ["→ q0", "{q0}U{}"],
      ["q1", "{q1}U{q2}"],
      ["q2*", "{q2}U{}"],
    ]);
    expect(cellTexts(nfa)[0]).toEqual(["Estados", "E", "a"]);
    expect(cellTexts(dfa)).toEqual([
      ["Estados", "a"],
      ["→ {q0}U{} = q0", "{q1}U{q2} = q1*"],
      ["{q1}U{q2} = q1*", ""],
    ]);
  });

  it("creates the resulting DFA in a new tab", async () => {
    const { container, ctx } = await setup();
    const button = container.querySelector(".conversion-create");
    button.click();
    expect(ctx.createDfaTab).toHaveBeenCalledWith({
      states: ["q0", "q1"],
      initial: "q0",
      accepting: ["q1"],
      transitions: [{ from: "q0", symbol: "a", to: "q1" }],
    });
  });

  it("without an initial state, explains why and disables creating the DFA", async () => {
    const { container } = await setup(snapshot({ withInitial: false }));
    expect(container.querySelector(".conversion-create").disabled).toBe(true);
    expect(container.querySelector(".conversion-note").textContent).toMatch(/estado inicial/);
  });

  it("recomputes when the automaton changes", async () => {
    const { container, docStore } = await setup();
    docStore.loadSnapshot(snapshot({ withInitial: false }));
    expect(container.querySelector(".conversion-create").disabled).toBe(true);
  });
});
