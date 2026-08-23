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

describe("parseSymbolList", () => {
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
