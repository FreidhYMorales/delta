import { describe, expect, it } from "vitest";
import { derivationText, layoutDerivationTree, outcomeLabel, parseBatch } from "./derivationLogic.js";

const node = (label, kind, children = []) => ({ label, kind, children });

describe("layoutDerivationTree", () => {
  it("places leaves left to right in derivation order and parents centered above their children", () => {
    // S -> A1B, A -> ε, B -> ε
    const tree = {
      root: 0,
      nodes: [
        node("S", "nonterminal", [1, 2, 3]),
        node("A", "nonterminal", [4]),
        node("1", "terminal"),
        node("B", "nonterminal", [5]),
        node("ε", "epsilon"),
        node("ε", "epsilon"),
      ],
    };
    const at = layoutDerivationTree(tree, { leafSpacing: 40, levelSpacing: 60 });
    expect(at[4].x).toBeLessThan(at[2].x);
    expect(at[2].x).toBeLessThan(at[5].x);
    expect(at[1].x).toBe(at[4].x);
    expect(at[0].x).toBe((at[1].x + at[2].x + at[3].x) / 3);
    expect(at[0].y).toBe(0);
    expect(at[1].y).toBe(60);
    expect(at[4].y).toBe(120);
  });

  it("puts a node shared by several parents (a multi-symbol rewrite) one level below the deepest of them", () => {
    // S -> aA, then aA -> b: both a and A point to b.
    const tree = {
      root: 0,
      nodes: [node("S", "nonterminal", [1, 2]), node("a", "terminal", [3]), node("A", "nonterminal", [3]), node("b", "terminal")],
    };
    const at = layoutDerivationTree(tree, { leafSpacing: 40, levelSpacing: 50 });
    expect(at[3].y).toBe(100);
    // Its parents are spread side by side above it, not stacked on one spot.
    expect(at[1].x).toBeLessThan(at[2].x);
  });
});

describe("layoutDerivationTree — type-0 rule junctions", () => {
  it("spreads the symbols that lead into one rule node side by side above it", () => {
    // S -> abAS, then abA -> baab through one rule node.
    const tree = {
      root: 0,
      nodes: [
        node("S", "nonterminal", [1, 2, 3, 4]),
        node("a", "terminal", [5]),
        node("b", "terminal", [5]),
        node("A", "nonterminal", [5]),
        node("S", "nonterminal", [10]),
        node("abA → baab", "rule", [6, 7, 8, 9]),
        node("b", "terminal"),
        node("a", "terminal"),
        node("a", "terminal"),
        node("b", "terminal"),
        node("a", "terminal"),
      ],
    };
    const at = layoutDerivationTree(tree, { leafSpacing: 40, levelSpacing: 50 });
    expect(at[1].x).toBeLessThan(at[2].x);
    expect(at[2].x).toBeLessThan(at[3].x);
    expect(at[2].x).toBe(at[5].x); // the middle one sits right above the rule
    expect(at[3].x - at[1].x).toBe(80);
    expect(at[5].y).toBe(100);
    expect(at[6].y).toBe(150);
  });
});

describe("derivationText", () => {
  it("writes the derivation as S ⇒ … ⇒ w", () => {
    expect(derivationText({ forms: ["S", "aS", "ab"] })).toBe("S ⇒ aS ⇒ ab");
  });
});

describe("outcomeLabel", () => {
  it("names each outcome", () => {
    expect(outcomeLabel("accepted")).toBe("✓ Aceptada");
    expect(outcomeLabel("rejected")).toBe("✗ Rechazada");
    expect(outcomeLabel("limit_reached")).toBe("? No determinada (límite de búsqueda)");
  });
});

describe("parseBatch", () => {
  it("takes one string per line, trimmed, skipping blank lines; ε stands for the empty string", () => {
    expect(parseBatch("  ab \n\nba\nε\n")).toEqual(["ab", "ba", "ε"]);
  });
});
