// Pure logic for the L2 testing drawer (task 7.6, spec `fa-simulation`,
// design D3/D6). `sim_trace`/`sim_batch` take an already-tokenized
// `Vec<String>` word (see `src-tauri/src/commands/sim.rs`); the Rust side
// has no tokenizer of its own (Testing Strategy's "tokenizer longest-match"
// row is this module), so a raw input string is split against the
// document's known alphabet here, greedy-longest-match first so multi-char
// symbols (e.g. "ab") are preferred over two one-char matches, and any
// character not covered by the alphabet falls back to a single-char symbol
// (it simply won't match any transition, which is the correct "no such
// symbol" outcome rather than a tokenizing error).

/**
 * @param {string} input raw string typed by the user (already trimmed of
 *   surrounding whitespace by the caller if desired — this function does not
 *   strip anything, so `" "` tokenizes as a literal space symbol)
 * @param {string[]} alphabet known symbol labels (may contain multi-char
 *   symbols), longest-match order is computed internally
 * @returns {string[]} the word as a `Vec<String>`-shaped array of symbols
 */
export function tokenizeInput(input, alphabet) {
  if (!input) return [];
  const known = [...new Set(alphabet)].sort((a, b) => b.length - a.length);
  const symbols = [];
  let i = 0;
  while (i < input.length) {
    const match = known.find((sym) => sym.length > 0 && input.startsWith(sym, i));
    if (match) {
      symbols.push(match);
      i += match.length;
    } else {
      symbols.push(input[i]);
      i += 1;
    }
  }
  return symbols;
}

/**
 * Split batch-mode textarea content into one input string per line (spec
 * `fa-simulation` > "Batch String Testing"). A single trailing newline is
 * dropped (the common "one Enter after the last line" case); any other
 * blank line is kept as a literal empty-string ("ε") test case, matching
 * the single-trace field's own "no input = ε" semantics.
 * @param {string} text
 * @returns {string[]}
 */
export function parseBatchLines(text) {
  if (text === "") return [];
  const withoutTrailingNewline = text.endsWith("\n") ? text.slice(0, -1) : text;
  return withoutTrailingNewline.split("\n");
}

const OUTCOME_LABELS = {
  Accepted: "Accepted",
  Rejected: "Rejected",
  Stuck: "Stuck",
  TruncatedSteps: "Truncated (step budget)",
  TruncatedConfigs: "Truncated (config budget)",
};

/** @param {string} outcome one of `TraceDto.outcome`'s Rust-side values */
export function verdictLabel(outcome) {
  return OUTCOME_LABELS[outcome] ?? outcome;
}

/**
 * @param {string} outcome
 * @returns {boolean} true for the two "ran out of budget" outcomes, so the
 *   UI can style them distinctly from a clean Accept/Reject/Stuck.
 */
export function isTruncated(outcome) {
  return outcome === "TruncatedSteps" || outcome === "TruncatedConfigs";
}

/**
 * @param {number[]} stepStateIds active state ids at one trace step
 * @param {Map<number,string>} labelOf
 * @returns {string} comma-joined state labels, in id order, for display
 */
export function formatStepStates(stepStateIds, labelOf) {
  return stepStateIds.map((id) => labelOf.get(id) ?? `#${id}`).join(", ");
}
