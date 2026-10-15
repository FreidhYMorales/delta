import { describe, expect, it } from "vitest";
import { CHOMSKY_TABLE, formText, formalDefinition, grammarTypeName } from "./grammarTabLogic.js";

const t = (name) => ({ kind: "terminal", name });
const n = (name) => ({ kind: "nonterminal", name });

describe("formText", () => {
  it("joins symbols, bracketing multi-character names and showing ε for an empty side", () => {
    expect(formText([t("a"), n("S"), t("b")])).toBe("aSb");
    expect(formText([t("if"), n("cond")])).toBe("'if'<cond>");
    expect(formText([])).toBe("ε");
  });
});

describe("formalDefinition", () => {
  it("writes G = {Σ, N, S, P} the way the course does", () => {
    const grammar = {
      terminals: ["a", "b"],
      nonterminals: ["S", "A"],
      start: "S",
      productions: [
        { lhs: [n("S")], rhs: [t("a"), n("A")], line: 1 },
        { lhs: [n("A")], rhs: [], line: 2 },
      ],
      warnings: [],
    };
    expect(formalDefinition(grammar)).toEqual({
      sigma: "Σ = {a, b}",
      n: "N = {S, A}",
      s: "S = S",
      productions: ["S → aA", "A → ε"],
    });
  });
});

describe("formalDefinition — large alphabets", () => {
  const letters = (from, to) => Array.from({ length: to.charCodeAt(0) - from.charCodeAt(0) + 1 }, (_, i) => String.fromCharCode(from.charCodeAt(0) + i));

  it("groups each non-terminal's alternatives on one line, as the course writes them", () => {
    const grammar = {
      terminals: ["a", "b"],
      nonterminals: ["S", "A"],
      start: "S",
      productions: [
        { lhs: [n("S")], rhs: [t("a"), n("A")], line: 1 },
        { lhs: [n("A")], rhs: [t("b")], line: 2 },
        { lhs: [n("S")], rhs: [], line: 3 },
      ],
      warnings: [],
    };
    expect(formalDefinition(grammar).productions).toEqual(["S → aA | ε", "A → b"]);
  });

  it("compresses runs of consecutive characters into first, second, …, last", () => {
    const grammar = {
      terminals: [...letters("A", "Z"), ...letters("a", "z")],
      nonterminals: ["M", "L"],
      start: "M",
      productions: [
        ...letters("A", "Z").map((c) => ({ lhs: [n("M")], rhs: [t(c)], line: 1 })),
        ...letters("a", "c").map((c) => ({ lhs: [n("L")], rhs: [t(c)], line: 2 })),
      ],
      warnings: [],
    };
    const def = formalDefinition(grammar);
    expect(def.sigma).toBe("Σ = {A, B, …, Z, a, b, …, z}");
    // Runs shorter than four stay as they are.
    expect(def.productions).toEqual(["M → A | B | … | Z", "L → a | b | c"]);
  });
});

describe("Chomsky hierarchy reference", () => {
  it("has the course table's four rows, type 0 to 3", () => {
    expect(CHOMSKY_TABLE.map((r) => r.type)).toEqual([0, 1, 2, 3]);
    expect(CHOMSKY_TABLE[2]).toMatchObject({ automaton: "Autómata con pila", productions: "A → γ" });
    expect(CHOMSKY_TABLE[3]).toMatchObject({ automaton: "Autómata finito" });
  });

  it("names each grammar type", () => {
    expect(grammarTypeName(3)).toBe("Gramática regular");
    expect(grammarTypeName(2)).toBe("Gramática libre de contexto");
    expect(grammarTypeName(1)).toBe("Gramática dependiente del contexto");
    expect(grammarTypeName(0)).toBe("Gramática sin restricciones");
  });
});
