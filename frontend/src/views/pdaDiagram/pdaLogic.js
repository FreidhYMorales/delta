// Pure (DOM-free) helpers for `PdaDiagramView`/`pdaRegistry.js` — parsing
// the "three sequential prompts" (input, pop, push) UX and formatting the
// transition label text. Geometry itself is NOT duplicated here — see
// `mealyLogic.js`'s doc comment for why `views/diagram/geometry.js`'s pure
// functions are imported directly by the diagram view instead.

/** This project's own established epsilon glyph (already used for FA
 * epsilon transitions in `views/diagram/DiagramView.js`) — used here
 * instead of real JFLAP's own "λ" glyph, for visual consistency across
 * every editor in this app. */
export const EPSILON = "ε";

/**
 * Parse a single input-symbol prompt string (e.g. "a"). Blank text means
 * epsilon, represented as `null` on the wire (`PdaTransitionView.input:
 * Option<String>`) — distinct from a cancelled prompt, which resolves the
 * whole prompt with `null` before this function is even called (see
 * `promptModal.js`'s doc comment).
 * @param {string} text
 * @returns {string|null}
 */
export function parseInputSymbol(text) {
  const trimmed = (text ?? "").trim();
  return trimmed ? trimmed : null;
}

/**
 * Parse a pop/push string-list prompt — space- or comma-separated symbol
 * labels (e.g. "A Z" or "A, Z"). A separator is required (unlike real
 * JFLAP's raw single-character strings) because this project's stack
 * symbols are atomic `SymbolId` labels that can be more than one character
 * (see docs/decisions.md, the PDA backend entry).
 * @param {string} text
 * @returns {string[]} empty array = epsilon (pop/push nothing).
 */
export function parseSymbolList(text) {
  return (text ?? "")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
}

/** @param {string[]} symbols @returns {string} e.g. "A Z", for prefilling an edit prompt. */
export function formatSymbolListForPrompt(symbols) {
  return (symbols ?? []).join(" ");
}

/** @param {string[]} symbols @returns {string} e.g. "A, Z", or "ε" when empty — display only. */
export function formatSymbolList(symbols) {
  return symbols && symbols.length ? symbols.join(", ") : EPSILON;
}

/**
 * Real JFLAP's own transition label format (`PDATransition.getDescription`,
 * verified this session by decompiling `automata/pda/PDATransition.class`
 * with `cfr`): `"{input} , {pop} ; {push}"`, blank fields shown as epsilon.
 * @param {string|null} input @param {string[]} pop @param {string[]} push
 * @returns {string}
 */
export function formatTransitionLabel(input, pop, push) {
  return `${input || EPSILON} , ${formatSymbolList(pop)} ; ${formatSymbolList(push)}`;
}
