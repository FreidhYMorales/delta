import { describe, expect, it } from "vitest";
import {
  BLANK,
  effectiveTapeCount,
  formatTapeCells,
  formatTapeOpForPrompt,
  formatTransitionLabel,
  parseTapeOpText,
} from "./tmLogic.js";

describe("parseTapeOpText", () => {
  it("parses 'read ; write , direction', trimming every part", () => {
    expect(parseTapeOpText(" a ; b , R ")).toEqual({ read: "a", write: "b", direction: "R" });
  });

  it("round-trips with formatTapeOpForPrompt", () => {
    const tape = { read: "a", write: "b", direction: "L" };
    expect(parseTapeOpText(formatTapeOpForPrompt(tape))).toEqual(tape);
  });

  it("defaults a blank read to the blank glyph", () => {
    expect(parseTapeOpText(" ; b , R")).toEqual({ read: BLANK, write: "b", direction: "R" });
  });

  it("defaults a blank write to the blank glyph", () => {
    expect(parseTapeOpText("a ; , R")).toEqual({ read: "a", write: BLANK, direction: "R" });
  });

  it("defaults both blank read and write to the blank glyph", () => {
    expect(parseTapeOpText(" ; , S")).toEqual({ read: BLANK, write: BLANK, direction: "S" });
  });

  it("uppercases a lowercase direction", () => {
    expect(parseTapeOpText("a ; a , r")).toEqual({ read: "a", write: "a", direction: "R" });
  });

  it("defaults an invalid direction to Stay, mirroring tm_ipc.rs::parse_direction's fallback", () => {
    expect(parseTapeOpText("a ; a , X")).toEqual({ read: "a", write: "a", direction: "S" });
    expect(parseTapeOpText("a ; a , ")).toEqual({ read: "a", write: "a", direction: "S" });
  });

  it("tolerates entirely blank/empty text", () => {
    expect(parseTapeOpText("")).toEqual({ read: BLANK, write: BLANK, direction: "S" });
    expect(parseTapeOpText(null)).toEqual({ read: BLANK, write: BLANK, direction: "S" });
  });
});

describe("formatTapeOpForPrompt", () => {
  it("formats as 'read ; write , direction'", () => {
    expect(formatTapeOpForPrompt({ read: "a", write: "b", direction: "R" })).toBe("a ; b , R");
  });
});

describe("formatTransitionLabel", () => {
  it("formats a single tape as 'read ; write , direction', real JFLAP's own per-tape format", () => {
    expect(formatTransitionLabel([{ read: "a", write: "b", direction: "R" }])).toBe("a ; b , R");
  });

  it("joins multiple tapes with ' | ', real JFLAP's own multi-tape join", () => {
    expect(
      formatTransitionLabel([
        { read: "a", write: "b", direction: "R" },
        { read: "c", write: "d", direction: "L" },
      ]),
    ).toBe("a ; b , R | c ; d , L");
  });

  it("returns an empty string for no tapes", () => {
    expect(formatTransitionLabel([])).toBe("");
    expect(formatTransitionLabel(undefined)).toBe("");
  });
});

describe("formatTapeCells", () => {
  it("shows an empty tape as [—] plus the head position", () => {
    expect(formatTapeCells({ cells: {}, head: 0 })).toBe("[—] head@0");
  });

  it("sorts sparse cell entries by numeric position and comma-joins pos=symbol pairs", () => {
    expect(formatTapeCells({ cells: { 1: "b", 0: "a" }, head: 2 })).toBe("[0=a, 1=b] head@2");
  });

  it("sorts numerically, not lexicographically (10 after 2, not before)", () => {
    expect(formatTapeCells({ cells: { 10: "x", 2: "y" }, head: 0 })).toBe("[2=y, 10=x] head@0");
  });

  it("handles negative positions (the head can move left of the start)", () => {
    expect(formatTapeCells({ cells: { "-1": "a", 0: "b" }, head: -1 })).toBe("[-1=a, 0=b] head@-1");
  });
});

describe("effectiveTapeCount", () => {
  it("falls back to ctx.tapeCountChoice when the document has no locked tape_count yet", () => {
    expect(effectiveTapeCount({ derived: { tape_count: 0 } }, { tapeCountChoice: 3 })).toBe(3);
  });

  it("uses the locked docStore.derived.tape_count once set, ignoring ctx.tapeCountChoice", () => {
    expect(effectiveTapeCount({ derived: { tape_count: 2 } }, { tapeCountChoice: 5 })).toBe(2);
  });
});
