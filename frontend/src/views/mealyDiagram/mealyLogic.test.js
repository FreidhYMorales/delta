import { describe, expect, it } from "vitest";
import { formatTransitionEntries, mergeTransitionEntry, parseTransitionPrompt } from "./mealyLogic.js";

describe("parseTransitionPrompt", () => {
  it("parses a well-formed input/output pair", () => {
    expect(parseTransitionPrompt("a/x")).toEqual({ input: "a", output: "x" });
  });

  it("trims whitespace around both sides", () => {
    expect(parseTransitionPrompt("  a  /  x  ")).toEqual({ input: "a", output: "x" });
  });

  it("returns null for missing input", () => {
    expect(parseTransitionPrompt("")).toBeNull();
    expect(parseTransitionPrompt(null)).toBeNull();
  });

  it("returns null when there is no '/'", () => {
    expect(parseTransitionPrompt("ax")).toBeNull();
  });

  it("returns null when either side is empty", () => {
    expect(parseTransitionPrompt("/x")).toBeNull();
    expect(parseTransitionPrompt("a/")).toBeNull();
  });
});

describe("formatTransitionEntries", () => {
  it("formats multiple pairs comma-separated", () => {
    expect(
      formatTransitionEntries([
        ["a", "x"],
        ["b", "y"],
      ]),
    ).toBe("a/x, b/y");
  });

  it("formats an empty list as an empty string", () => {
    expect(formatTransitionEntries([])).toBe("");
  });
});

describe("mergeTransitionEntry", () => {
  it("appends a new input that wasn't there before", () => {
    expect(mergeTransitionEntry([["a", "x"]], "b", "y")).toEqual([
      ["a", "x"],
      ["b", "y"],
    ]);
  });

  it("replaces the output for an input that already exists", () => {
    expect(mergeTransitionEntry([["a", "x"], ["b", "y"]], "a", "z")).toEqual([
      ["b", "y"],
      ["a", "z"],
    ]);
  });
});
