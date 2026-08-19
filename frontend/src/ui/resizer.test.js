import { describe, expect, it } from "vitest";
import { clampPaneWidth } from "./resizer.js";

describe("clampPaneWidth", () => {
  it("passes values inside the range through unchanged", () => {
    expect(clampPaneWidth(50)).toBe(50);
  });

  it("clamps below the minimum", () => {
    expect(clampPaneWidth(10)).toBe(35);
  });

  it("clamps above the maximum", () => {
    expect(clampPaneWidth(90)).toBe(70);
  });

  it("respects custom bounds", () => {
    expect(clampPaneWidth(10, 20, 80)).toBe(20);
    expect(clampPaneWidth(90, 20, 80)).toBe(80);
  });
});
