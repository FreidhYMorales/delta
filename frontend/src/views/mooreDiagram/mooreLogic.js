// Pure (DOM-free) helpers for `MooreDiagramView` — the parsing/formatting
// half of the "one input symbol per prompt" UX (simpler than Mealy's
// "input/output" pair prompt, since a Moore edge carries no output at all —
// output lives on the destination state instead, set via `state.setOutput`
// in `mooreRegistry.js`). Geometry itself is NOT duplicated here — see
// `mealyLogic.js`'s doc comment for why `views/diagram/geometry.js`'s pure
// functions are imported directly by the diagram view instead.

/**
 * Parse a single input-symbol prompt string (e.g. "a").
 * @param {string} text
 * @returns {string|null} the trimmed symbol, or `null` if empty/blank.
 */
export function parseInputPrompt(text) {
  if (!text) return null;
  const input = text.trim();
  return input ? input : null;
}

/**
 * @param {string[]} inputs e.g. from `MooreEdgeView.inputs`.
 * @returns {string} e.g. "a, b"
 */
export function formatInputs(inputs) {
  return inputs.join(", ");
}

/**
 * Merge a new input symbol into an edge's existing inputs, without
 * duplicating it if already present (redrawing the same edge with the same
 * symbol is a no-op change, not a duplicate entry).
 * @param {string[]} existingInputs
 * @param {string} input
 * @returns {string[]}
 */
export function mergeInput(existingInputs, input) {
  if (existingInputs.includes(input)) return existingInputs;
  return [...existingInputs, input];
}
