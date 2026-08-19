import { describe, expect, it } from "vitest";
import { formatInputs, mergeInput, parseInputPrompt } from "./mooreLogic.js";

describe("parseInputPrompt", () => {
  it("trims and returns the symbol", () => {
    expect(parseInputPrompt("  a  ")).toBe("a");
  });

  it("returns null for empty or blank input", () => {
    expect(parseInputPrompt("")).toBeNull();
    expect(parseInputPrompt("   ")).toBeNull();
    expect(parseInputPrompt(null)).toBeNull();
    expect(parseInputPrompt(undefined)).toBeNull();
  });
});

describe("formatInputs", () => {
  it("joins symbols with ', '", () => {
    expect(formatInputs(["a", "b"])).toBe("a, b");
  });

  it("returns an empty string for no symbols", () => {
    expect(formatInputs([])).toBe("");
  });
});

describe("mergeInput", () => {
  it("appends a new symbol", () => {
    expect(mergeInput(["a"], "b")).toEqual(["a", "b"]);
  });

  it("does not duplicate an already-present symbol", () => {
    expect(mergeInput(["a", "b"], "a")).toEqual(["a", "b"]);
  });

  it("starts from an empty list", () => {
    expect(mergeInput([], "a")).toEqual(["a"]);
  });
});
