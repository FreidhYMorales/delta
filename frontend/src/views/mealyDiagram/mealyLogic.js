// Pure (DOM-free) helpers for `MealyDiagramView` — the parsing/formatting
// half of the "one input/output pair per prompt" UX. Geometry itself is
// NOT duplicated here: `circleLayout`/`edgeEndpoints`/`preferredLoopAngle`/
// `selfLoopPath`/`curvedEdgePath`/`nextStateLabel`
// (`views/diagram/geometry.js`) are pure functions of `{x,y}`/`{id,label}`
// with nothing FA-specific in their signatures, so `MealyDiagramView`
// imports them directly instead of re-deriving the same curve math.

/**
 * Parse a single "input/output" prompt string (e.g. "a/x") — the compact
 * notation `automata-cli mealy-sim`'s own examples and docs/decisions.md
 * use, chosen so one prompt covers a whole transition instead of two.
 * @param {string} text
 * @returns {{input:string, output:string}|null} `null` if malformed (no
 *   '/', or either side empty after trimming).
 */
export function parseTransitionPrompt(text) {
  if (!text) return null;
  const idx = text.indexOf("/");
  if (idx === -1) return null;
  const input = text.slice(0, idx).trim();
  const output = text.slice(idx + 1).trim();
  if (!input || !output) return null;
  return { input, output };
}

/**
 * @param {[string,string][]} entries `[input, output]` pairs, e.g. from
 *   `MealyEdgeView.transitions`.
 * @returns {string} e.g. "a/x, b/y"
 */
export function formatTransitionEntries(entries) {
  return entries.map(([input, output]) => `${input}/${output}`).join(", ");
}

/**
 * Merge a new `(input, output)` pair into an edge's existing entries,
 * replacing any prior entry for the same `input` (redrawing the same edge
 * with the same input symbol updates its output instead of duplicating the
 * pair — same "re-apply overwrites" convention `TableView`'s cell editing
 * already uses for FA edges).
 * @param {[string,string][]} existingEntries
 * @param {string} input
 * @param {string} output
 * @returns {[string,string][]}
 */
export function mergeTransitionEntry(existingEntries, input, output) {
  const merged = existingEntries.filter(([existingInput]) => existingInput !== input);
  merged.push([input, output]);
  return merged;
}
