import { describe, expect, it } from "vitest";
import { applyGreekSymbols, greekSymbolFor } from "./greekSymbols.js";

describe("greekSymbolFor", () => {
  it("recognizes letters across the alphabet", () => {
    expect(greekSymbolFor("delta")).toBe("δ");
    expect(greekSymbolFor("sigma")).toBe("σ");
    expect(greekSymbolFor("lambda")).toBe("λ");
    expect(greekSymbolFor("omega")).toBe("ω");
  });

  it("returns the lowercase glyph for lowercase input", () => {
    expect(greekSymbolFor("delta")).toBe("δ");
  });

  it("returns the uppercase glyph for capitalized input", () => {
    expect(greekSymbolFor("Delta")).toBe("Δ");
  });

  it("returns null for an unrecognized word", () => {
    expect(greekSymbolFor("banana")).toBeNull();
  });

  it("matches case-insensitively", () => {
    expect(greekSymbolFor("DELTA")).not.toBeNull();
    expect(greekSymbolFor("Delta")).not.toBeNull();
  });

  it("treats an all-caps word as capitalized (only the first char is checked), same outcome as a leading-capital word", () => {
    // /^[A-Z]/ only inspects the FIRST character, so "DELTA" (all caps)
    // still matches (true, first char is uppercase) and yields the
    // uppercase glyph -- same result as "Delta".
    expect(greekSymbolFor("DELTA")).toBe("Δ");
    expect(greekSymbolFor("Delta")).toBe("Δ");
  });
});

describe("applyGreekSymbols", () => {
  it("converts a lone word", () => {
    expect(applyGreekSymbols("delta")).toBe("δ");
  });

  it("converts each word in a comma-separated list, preserving separators and spacing", () => {
    expect(applyGreekSymbols("delta, sigma, a")).toBe("δ, σ, a");
  });

  it("converts each side of a slash-separated composite string", () => {
    expect(applyGreekSymbols("delta/sigma")).toBe("δ/σ");
  });

  it("leaves numbers, punctuation, and unrecognized words untouched", () => {
    expect(applyGreekSymbols("q0, banana, 42!")).toBe("q0, banana, 42!");
  });

  it("is idempotent on an already-symbolic string", () => {
    expect(applyGreekSymbols("δ, σ, a")).toBe("δ, σ, a");
  });

  it("handles an empty string", () => {
    expect(applyGreekSymbols("")).toBe("");
  });
});
