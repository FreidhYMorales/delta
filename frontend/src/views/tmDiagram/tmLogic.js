// Pure (DOM-free) helpers for `TmDiagramView`/`tmRegistry.js`/`TmSimView` —
// parsing the "one prompt per tape" UX and formatting transition labels and
// tape contents. Mirrors `pdaLogic.js`'s role, adapted for TM's variable
// tape count (1-5, `TmDoc::tape_count`) instead of PDA's fixed three fields.
//
// TM has no epsilon concept (unlike PDA/FA) — only the blank glyph `"□"`,
// which is just a normal symbol label as far as display/parsing goes (see
// `model::tm::BLANK`), so unlike `pdaLogic.js`'s `EPSILON` there is no
// separate "epsilon substitution" step here.

/** This project's already-established TM blank glyph (`model::tm::BLANK`,
 * `src-tauri`) — also real JFLAP's own default for an unset read/write field
 * (`TMTransition.setRead`/`setWrite`, decompiled this session). */
export const BLANK = "□";

/**
 * Parse one tape's "read ; write , direction" prompt string — the same
 * format `formatTapeOpForPrompt`/`formatTransitionLabel` render, so what you
 * see is what you type back to edit (design decision, see the TM frontend
 * round's spec). Split on `;` first (read | rest), then split rest on `,`
 * (write | direction); every part is trimmed.
 *
 * Blank read/write default to the blank glyph, matching real JFLAP's own
 * `TMTransition.setRead`/`setWrite` default (decompiled this session).
 * Direction is trimmed/uppercased; anything other than exactly "L"/"R"/"S"
 * defaults to "S" (Stay), mirroring `tm_ipc.rs::parse_direction`'s own
 * fallback-to-Stay convention, kept consistent with the server side.
 * @param {string} text
 * @returns {{read:string, write:string, direction:string}}
 */
export function parseTapeOpText(text) {
  const raw = text ?? "";
  const semiIndex = raw.indexOf(";");
  const readPart = semiIndex === -1 ? raw : raw.slice(0, semiIndex);
  const rest = semiIndex === -1 ? "" : raw.slice(semiIndex + 1);
  const commaIndex = rest.indexOf(",");
  const writePart = commaIndex === -1 ? rest : rest.slice(0, commaIndex);
  const directionPart = commaIndex === -1 ? "" : rest.slice(commaIndex + 1);

  const read = readPart.trim() || BLANK;
  const write = writePart.trim() || BLANK;
  const dir = directionPart.trim().toUpperCase();
  const direction = dir === "L" || dir === "R" || dir === "S" ? dir : "S";

  return { read, write, direction };
}

/**
 * @param {{read:string,write:string,direction:string}} tape
 * @returns {string} e.g. "a ; b , R", for prefilling an edit prompt (mirrors
 * `pdaLogic.js`'s `formatSymbolListForPrompt`).
 */
export function formatTapeOpForPrompt(tape) {
  return `${tape?.read ?? ""} ; ${tape?.write ?? ""} , ${tape?.direction ?? ""}`;
}

/**
 * Real JFLAP's own transition label format (`TMTransition.getDescription`,
 * verified this session by decompiling `automata/turing/TMTransition.class`
 * with `cfr`): per-tape `"{read} ; {write} , {direction}"`, joined with
 * `" | "` across tapes. E.g. 2 tapes: `"a ; b , R | c ; d , L"`.
 * @param {{read:string,write:string,direction:string}[]} tapes
 * @returns {string}
 */
export function formatTransitionLabel(tapes) {
  return (tapes ?? []).map((t) => `${t.read} ; ${t.write} , ${t.direction}`).join(" | ");
}

/**
 * One tape's live contents for the Simular panel — sorted by numeric
 * position, `pos=symbol` pairs comma-joined inside brackets (mirrors PDA's
 * `[${stack.join(" ")}]` bracket convention), or `[—]` when empty (matches
 * PDA's `|| "—"` empty-stack fallback), then a `head@N` suffix.
 * @param {{cells: Record<string|number,string>, head:number}} tape
 * @returns {string}
 */
export function formatTapeCells(tape) {
  const cells = tape?.cells ?? {};
  const entries = Object.entries(cells)
    .map(([pos, sym]) => [Number(pos), sym])
    .sort((a, b) => a[0] - b[0]);
  const body = entries.length ? entries.map(([pos, sym]) => `${pos}=${sym}`).join(", ") : "—";
  return `[${body}] head@${tape?.head ?? 0}`;
}

/**
 * How many per-tape prompts/fields to show right now. `TmDoc::tape_count` is
 * `0` until the first transition is ever added, then locked forever (see
 * `model::tm.rs`), so before that point the frontend falls back to the
 * user's own pre-lock choice (`ctx.tapeCountChoice`) — used by both
 * `TmToolbar`'s tape-count select and the create/edit-transition prompt flow
 * (`tmRegistry.js`'s `promptTransitionTapes`) so they never disagree on how
 * many tapes a not-yet-locked document should be treated as having.
 * @param {{derived:{tape_count:number}}} docStore
 * @param {{tapeCountChoice:number}} ctx
 * @returns {number}
 */
export function effectiveTapeCount(docStore, ctx) {
  const locked = docStore?.derived?.tape_count ?? 0;
  return locked > 0 ? locked : (ctx?.tapeCountChoice ?? 1);
}
