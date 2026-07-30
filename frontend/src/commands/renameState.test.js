import { describe, expect, it } from "vitest";
import { wasRenamed } from "./renameState.js";

describe("wasRenamed (task 7.9)", () => {
  it("is true when a StateRenamed patch for the given id is present", () => {
    expect(wasRenamed([{ patch: "StateRenamed", id: 1, label: "Z" }], 1)).toBe(true);
  });

  it("is false when no patches came back (rename silently blocked)", () => {
    expect(wasRenamed([], 1)).toBe(false);
  });

  it("is false when patches exist but not a StateRenamed for this id", () => {
    expect(wasRenamed([{ patch: "StateMoved", id: 1, x: 0, y: 0 }], 1)).toBe(false);
    expect(wasRenamed([{ patch: "StateRenamed", id: 2, label: "Z" }], 1)).toBe(false);
  });
});
