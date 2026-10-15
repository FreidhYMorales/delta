import { describe, expect, it } from "vitest";
import { buildDirectTables, layoutSyntaxTree } from "./regexDirectLogic.js";
import { aOptionalB } from "./regexDirectFixtures.js";

describe("buildDirectTables", () => {
  it("step 1-2: numbered leaves, none of them nullable", () => {
    const { leaves } = buildDirectTables(aOptionalB());
    expect(leaves.headers).toEqual(["i", "Símbolo", "Anulable"]);
    expect(leaves.rows).toEqual([
      ["1", "a", "Falso"],
      ["2", "b", "Falso"],
      ["3", "#", "Falso"],
    ]);
  });

  it("step 3-4: every node (post-order) with its subexpression, nullable, firstpos and lastpos", () => {
    const { nodes } = buildDirectTables(aOptionalB());
    expect(nodes.headers).toEqual(["Nodo", "Anulable", "PrimeraPos", "ÚltimaPos"]);
    expect(nodes.rows).toEqual([
      ["a (1)", "Falso", "{1}", "{1}"],
      ["a?", "Verdadero", "{1}", "{1}"],
      ["b (2)", "Falso", "{2}", "{2}"],
      ["a?b", "Falso", "{1,2}", "{2}"],
      ["# (3)", "Falso", "{3}", "{3}"],
      ["(a?b)#", "Falso", "{1,2}", "{3}"],
    ]);
  });

  it("step 5: followpos per position", () => {
    const { followpos } = buildDirectTables(aOptionalB());
    expect(followpos.headers).toEqual(["i", "Símbolo", "SiguientePos"]);
    expect(followpos.rows).toEqual([
      ["1", "a", "{2}"],
      ["2", "b", "{3}"],
      ["3", "#", "{}"],
    ]);
  });

  it("step 6: D states as renamed sets, marking initial (→) and accepting (*)", () => {
    const { states } = buildDirectTables(aOptionalB());
    expect(states.headers).toEqual(["Conjunto", "Estado"]);
    expect(states.rows).toEqual([
      ["{1,2}", "→ A"],
      ["{2}", "B"],
      ["{3}", "C*"],
    ]);
  });

  it("step 7: D transitions, empty when there is no move", () => {
    const { transitions } = buildDirectTables(aOptionalB());
    expect(transitions.headers).toEqual(["Estado", "a", "b"]);
    expect(transitions.rows).toEqual([
      ["→ A", "B", "C"],
      ["B", "", "C"],
      ["C*", "", ""],
    ]);
  });

  it("the DFA model for a new tab, named like table D", () => {
    const { dfa } = buildDirectTables(aOptionalB());
    expect(dfa).toEqual({
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

  it("parenthesizes subexpressions only where needed", () => {
    // (a|b)*c: union under star and under concat needs parens.
    const sym = (label, position) => ({ kind: "symbol", label, position, children: [], nullable: false, firstpos: [position], lastpos: [position] });
    const op = (kind, label, children) => ({ kind, label, position: null, children, nullable: false, firstpos: [], lastpos: [] });
    const result = {
      ...aOptionalB(),
      nodes: [
        sym("a", 1),
        sym("b", 2),
        op("union", "|", [0, 1]),
        op("star", "*", [2]),
        sym("c", 3),
        op("concat", "·", [3, 4]),
        { ...sym("#", 4), kind: "end" },
        op("concat", "·", [5, 6]),
      ],
      root: 7,
    };
    const rows = buildDirectTables(result).nodes.rows.map((r) => r[0]);
    expect(rows).toEqual(["a (1)", "b (2)", "a|b", "(a|b)*", "c (3)", "(a|b)*c", "# (4)", "((a|b)*c)#"]);
  });
});

describe("layoutSyntaxTree", () => {
  it("puts leaves left to right, parents centered over their children, one row per depth", () => {
    const { nodes, root } = aOptionalB();
    const at = layoutSyntaxTree(nodes, root, { leafSpacing: 100, levelSpacing: 50 });
    // leaves in order: a(0), b(2), #(4)
    expect(at[0].x).toBeLessThan(at[2].x);
    expect(at[2].x).toBeLessThan(at[4].x);
    expect(at[2].x - at[0].x).toBe(100);
    // ? sits over its only child a; the inner concat over ? and b; root over the inner concat and #.
    expect(at[1].x).toBe(at[0].x);
    expect(at[3].x).toBe((at[1].x + at[2].x) / 2);
    expect(at[5].x).toBe((at[3].x + at[4].x) / 2);
    expect(at[5].y).toBe(0);
    expect(at[3].y).toBe(50);
    expect(at[1].y).toBe(100);
    expect(at[0].y).toBe(150);
  });
});
