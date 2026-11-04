import { describe, expect, it } from "vitest";
import {
  EPSILON,
  formatSymbolList,
  formatSymbolListForPrompt,
  formatTransitionLabel,
  parseInputSymbol,
  parseSymbolList,
} from "./pdaLogic.js";

describe("parseInputSymbol", () => {
  it("trims and returns a symbol", () => {
    expect(parseInputSymbol(" a ")).toBe("a");
  });

  it("returns null for blank/empty text (epsilon)", () => {
    expect(parseInputSymbol("")).toBeNull();
    expect(parseInputSymbol("   ")).toBeNull();
    expect(parseInputSymbol(null)).toBeNull();
  });
});

describe("empty markers", () => {
  it("reads λ and ε as an empty input", () => {
    expect(parseInputSymbol("λ")).toBeNull();
    expect(parseInputSymbol(" ε ")).toBeNull();
    expect(parseInputSymbol("a")).toBe("a");
  });

  it("reads λ and ε as an empty pop or push", () => {
    expect(parseSymbolList("λ")).toEqual([]);
    expect(parseSymbolList(" ε ")).toEqual([]);
    expect(parseSymbolList("A")).toEqual(["A"]);
  });
});

describe("parseSymbolList", () => {
  it("reads a stack string without separators one character per symbol", () => {
    expect(parseSymbolList("NZ")).toEqual(["N", "Z"]);
    expect(parseSymbolList("BNN, Z")).toEqual(["B", "N", "N", "Z"]);
  });

  it("prefers the longest symbol already known in the stack alphabet", () => {
    expect(parseSymbolList("AAZ0", ["A", "Z0"])).toEqual(["A", "A", "Z0"]);
    expect(parseSymbolList("NZ", ["NZ", "N", "Z"])).toEqual(["NZ"]);
  });

  it("splits on whitespace", () => {
    expect(parseSymbolList("A Z")).toEqual(["A", "Z"]);
  });

  it("splits on commas too, tolerating mixed separators", () => {
    expect(parseSymbolList("A, Z,B")).toEqual(["A", "Z", "B"]);
  });

  it("returns an empty array for blank text (pop/push nothing)", () => {
    expect(parseSymbolList("")).toEqual([]);
    expect(parseSymbolList("   ")).toEqual([]);
    expect(parseSymbolList(null)).toEqual([]);
  });
});

describe("formatSymbolListForPrompt", () => {
  it("space-joins symbols for prefilling an edit prompt", () => {
    expect(formatSymbolListForPrompt(["A", "Z"])).toBe("A Z");
  });

  it("returns an empty string for an empty/undefined list", () => {
    expect(formatSymbolListForPrompt([])).toBe("");
    expect(formatSymbolListForPrompt(undefined)).toBe("");
  });
});

describe("formatSymbolList", () => {
  it("comma-joins symbols for display", () => {
    expect(formatSymbolList(["A", "Z"])).toBe("A, Z");
  });

  it("shows epsilon for an empty list", () => {
    expect(formatSymbolList([])).toBe(EPSILON);
  });
});

describe("formatTransitionLabel", () => {
  it("formats as 'input , pop ; push', matching real JFLAP's own PDATransition.getDescription", () => {
    expect(formatTransitionLabel("a", ["Z"], ["A", "Z"])).toBe("a , Z ; A, Z");
  });

  it("shows epsilon for every blank field", () => {
    expect(formatTransitionLabel(null, [], [])).toBe(`${EPSILON} , ${EPSILON} ; ${EPSILON}`);
  });
});
