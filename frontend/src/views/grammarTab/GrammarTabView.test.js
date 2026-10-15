import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrammarTabView } from "./GrammarTabView.js";

const t = (name) => ({ kind: "terminal", name });
const n = (name) => ({ kind: "nonterminal", name });

function contextFreeAnalysis() {
  return {
    grammar: {
      terminals: ["a", "b"],
      nonterminals: ["S", "A"],
      start: "S",
      productions: [
        { lhs: [n("S")], rhs: [t("a"), n("A")], line: 1 },
        { lhs: [n("A")], rhs: [t("b"), n("A"), n("A")], line: 2 },
      ],
      warnings: ["el terminal 'c' se usa pero no está declarado en Σ"],
    },
    classification: {
      chomsky_type: 2,
      checks: [
        { level: 3, holds: false, explanation: "A → bAA: el lado derecho tiene más de un no terminal.", offending: "A → bAA" },
        { level: 2, holds: true, explanation: "Todo lado izquierdo es un único no terminal (A → γ).", offending: null },
        { level: 1, holds: true, explanation: "Toda producción tiene la forma xAy → xzy.", offending: null },
      ],
    },
    error: null,
  };
}

function fakeStore(source = "S -> aA\nA -> bAA", analysis = contextFreeAnalysis()) {
  const listeners = new Set();
  return {
    source,
    notation: "productions",
    revision: 0,
    analysis,
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    setSource: vi.fn().mockResolvedValue(undefined),
    setNotation: vi.fn().mockResolvedValue(undefined),
    derive: vi.fn(),
    emit(next) {
      Object.assign(this, next);
      for (const l of listeners) l();
    },
  };
}

function setup(store = fakeStore()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new GrammarTabView(container, store);
  return { container, view, store };
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GrammarTabView", () => {
  it("shows the document's source in the editor", () => {
    const { container } = setup();
    expect(container.querySelector(".grammar-source").value).toBe("S -> aA\nA -> bAA");
  });

  it("sends the text to the store once typing pauses, not on every keystroke", () => {
    const { container, store } = setup();
    const editor = container.querySelector(".grammar-source");
    editor.value = "S -> a";
    editor.dispatchEvent(new Event("input"));
    editor.value = "S -> ab";
    editor.dispatchEvent(new Event("input"));
    expect(store.setSource).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(store.setSource).toHaveBeenCalledTimes(1);
    expect(store.setSource).toHaveBeenCalledWith("S -> ab");
  });

  it("does not overwrite what the user is typing when an older snapshot arrives", () => {
    const { container, store } = setup();
    const editor = container.querySelector(".grammar-source");
    editor.value = "S -> abc";
    editor.dispatchEvent(new Event("input"));
    store.emit({ source: "S -> a" });
    expect(editor.value).toBe("S -> abc");
  });

  it("shows the formal definition G = {Σ, N, S, P}", () => {
    const { container } = setup();
    const text = container.querySelector(".grammar-definition").textContent;
    for (const part of ["Σ = {a, b}", "N = {S, A}", "S = S", "S → aA", "A → bAA"]) expect(text).toContain(part);
  });

  it("shows the Chomsky type, why each level holds or not, and highlights its row in the hierarchy table", () => {
    const { container } = setup();
    expect(container.querySelector(".chomsky-type").textContent).toBe("Tipo 2 · Gramática libre de contexto");
    const checks = [...container.querySelectorAll(".chomsky-check")];
    expect(checks.map((c) => c.classList.contains("holds"))).toEqual([false, true, true]);
    expect(checks[0].textContent).toContain("A → bAA");
    const current = container.querySelector(".chomsky-table tr.current");
    expect(current.textContent).toContain("Autómata con pila");
  });

  it("lists warnings", () => {
    const { container } = setup();
    expect(container.querySelector(".grammar-warnings").textContent).toContain("'c'");
  });

  it("on a parse error shows the line and message instead of the analysis", () => {
    const store = fakeStore("S a", { grammar: null, classification: null, error: { line: 1, message: "falta la flecha '->'" } });
    const { container } = setup(store);
    expect(container.querySelector(".grammar-error").textContent).toBe("Línea 1: falta la flecha '->'");
    expect(container.querySelector(".chomsky-type")).toBeNull();
    expect(container.querySelector(".grammar-definition").textContent).toBe("");
  });

  it("re-renders when the store changes", () => {
    const { container, store } = setup();
    store.emit({ analysis: { grammar: null, classification: null, error: { line: 2, message: "x" } } });
    expect(container.querySelector(".grammar-error").textContent).toBe("Línea 2: x");
  });

  it("includes the string-testing panel (one string or a batch), below the editor and the analysis", () => {
    const { container } = setup();
    const panel = container.querySelector(".grammar-tab > .grammar-derivations .derivation-panel");
    expect(panel).toBeTruthy();
    expect(panel.querySelector(".derive-input")).toBeTruthy();
    expect(panel.querySelector(".batch-input")).toBeTruthy();
  });

  it("switches notation through the store, and shows the BNF example and syntax when in BNF", () => {
    const { container, store } = setup();
    const select = container.querySelector(".grammar-notation");
    expect(select.value).toBe("productions");
    select.value = "bnf";
    select.dispatchEvent(new Event("change"));
    expect(store.setNotation).toHaveBeenCalledWith("bnf");
    store.emit({ notation: "bnf" });
    expect(container.querySelector(".grammar-source").placeholder).toContain("::=");
    expect(container.querySelector(".grammar-hint").textContent).toContain("{ }");
  });

  it("shows the EBNF → BNF conversion when the analysis has one", () => {
    const { container, store } = setup();
    expect(container.querySelector(".grammar-expansion").textContent).toBe("");
    store.emit({ notation: "bnf", analysis: { ...contextFreeAnalysis(), expansion: ["n ::= d n_rep1 .", "n_rep1 ::= d n_rep1 | ε ."] } });
    const lines = [...container.querySelectorAll(".grammar-expansion li")].map((li) => li.textContent);
    expect(lines).toEqual(["n ::= d n_rep1 .", "n_rep1 ::= d n_rep1 | ε ."]);
  });

  it("offers the grammar's non-terminals as start symbols for testing strings", () => {
    const { container } = setup();
    const options = [...container.querySelectorAll(".derive-start option")].map((o) => o.value);
    expect(options).toEqual(["", "S", "A"]);
  });
});
