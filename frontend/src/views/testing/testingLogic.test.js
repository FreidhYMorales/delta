import { describe, expect, it } from "vitest";
import {
  formatStepStates,
  isTruncated,
  parseBatchLines,
  tokenizeInput,
  verdictLabel,
} from "./testingLogic.js";

describe("tokenizeInput (task 7.6)", () => {
  it("returns an empty array for an empty string", () => {
    expect(tokenizeInput("", ["a", "b"])).toEqual([]);
  });

  it("splits into one-character symbols when the alphabet has no multi-char symbols", () => {
    expect(tokenizeInput("aba", ["a", "b"])).toEqual(["a", "b", "a"]);
  });

  it("prefers the longest matching alphabet symbol at each position", () => {
    expect(tokenizeInput("aabb", ["a", "aa", "b"])).toEqual(["aa", "b", "b"]);
  });

  it("falls back to a single character for symbols outside the alphabet", () => {
    expect(tokenizeInput("axb", ["a", "b"])).toEqual(["a", "x", "b"]);
  });
});

describe("parseBatchLines (task 7.6)", () => {
  it("returns an empty array for empty input", () => {
    expect(parseBatchLines("")).toEqual([]);
  });

  it("splits one string per line", () => {
    expect(parseBatchLines("ab\nba\naa")).toEqual(["ab", "ba", "aa"]);
  });

  it("drops exactly one trailing newline", () => {
    expect(parseBatchLines("ab\nba\n")).toEqual(["ab", "ba"]);
  });

  it("keeps an interior blank line as a literal epsilon test case", () => {
    expect(parseBatchLines("ab\n\naa")).toEqual(["ab", "", "aa"]);
  });
});

describe("verdictLabel / isTruncated (task 7.6)", () => {
  it("maps every known outcome to a display label", () => {
    expect(verdictLabel("Accepted")).toBe("Accepted");
    expect(verdictLabel("Rejected")).toBe("Rejected");
    expect(verdictLabel("Stuck")).toBe("Stuck");
    expect(verdictLabel("TruncatedSteps")).toContain("Truncated");
    expect(verdictLabel("TruncatedConfigs")).toContain("Truncated");
  });

  it("flags only the two truncated outcomes", () => {
    expect(isTruncated("TruncatedSteps")).toBe(true);
    expect(isTruncated("TruncatedConfigs")).toBe(true);
    expect(isTruncated("Accepted")).toBe(false);
    expect(isTruncated("Rejected")).toBe(false);
  });
});

describe("formatStepStates (task 7.6)", () => {
  it("joins active state labels in the given order", () => {
    const labelOf = new Map([
      [1, "q0"],
      [2, "q1"],
    ]);
    expect(formatStepStates([1, 2], labelOf)).toBe("q0, q1");
  });

  it("falls back to #id for an unknown id", () => {
    expect(formatStepStates([9], new Map())).toBe("#9");
  });
});
