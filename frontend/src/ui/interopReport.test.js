import { describe, expect, it } from "vitest";
import { reportItemLines, reportTitle } from "./interopReport.js";

describe("reportItemLines / reportTitle (task 7.7)", () => {
  it("formats each loss item as '[severity] code: detail'", () => {
    const report = {
      direction: "Import",
      items: [
        { severity: "Lossy", code: "MultiCharSymbol", detail: "folded 'ab' into one symbol", subject: {} },
        { severity: "Dropped", code: "UnknownElementDropped", detail: "removed <note>", subject: {} },
      ],
    };
    expect(reportItemLines(report)).toEqual([
      "[Lossy] MultiCharSymbol: folded 'ab' into one symbol",
      "[Dropped] UnknownElementDropped: removed <note>",
    ]);
  });

  it("returns an empty array for a report with no items", () => {
    expect(reportItemLines({ direction: "Export", items: [] })).toEqual([]);
    expect(reportItemLines(undefined)).toEqual([]);
  });

  it("builds a title with direction and item count", () => {
    expect(reportTitle({ direction: "Import", items: [{}] })).toBe("Import report — 1 item");
    expect(reportTitle({ direction: "Export", items: [{}, {}] })).toBe("Export report — 2 items");
    expect(reportTitle({ direction: "Export", items: [] })).toBe("Export report — 0 items");
  });
});
