// Pure formatting of `InteropReportDto` (design D5, `src-tauri/src/commands/jff.rs`
// `InteropReportDto`/`LossItemDto`) into plain-text lines for `showNotice`
// (task 7.7). Kept separate from `notice.js` / `main.js`'s wiring so the
// exact wording is unit-testable without DOM.

/**
 * @param {{direction:string, items:{severity:string,code:string,detail:string}[]}} report
 * @returns {string[]} one line per loss item, `[severity] code: detail`
 */
export function reportItemLines(report) {
  return (report?.items ?? []).map((item) => `[${item.severity}] ${item.code}: ${item.detail}`);
}

/**
 * @param {{direction:string, items: unknown[]}} report
 * @returns {string} e.g. "Import report — 2 items"
 */
export function reportTitle(report) {
  const n = report?.items?.length ?? 0;
  return `${report?.direction ?? "Interop"} report — ${n} item${n === 1 ? "" : "s"}`;
}
