// Pure logic for the Moore state-table view — same role as
// `mealyTable/mealyTableLogic.js` but genuinely separate rather than a
// shared module: a Moore cell holds plain target-state labels (no
// per-symbol output pairing — output lives on the state), and there's a
// dedicated "Salida" column with no Mealy equivalent at all. No accepting
// flag (only `->` marks the initial state, no `*`), no epsilon column.

/** @param {string} raw comma-separated target-state labels, e.g. "q1, q2" */
export function parseCellEntries(raw) {
  const out = [];
  for (const part of raw.split(",")) {
    const label = part.trim();
    if (label) out.push(label);
  }
  return out;
}

/**
 * The name-cell's editable value: `->` prefix (no `*` — Moore has no
 * accepting states) immediately before the label.
 * @param {{label:string, initial:boolean}} state
 */
export function nameWithMarkers(state) {
  return `${state.initial ? "->" : ""}${state.label}`;
}

/**
 * Parses a name-cell's raw typed value for the `->` prefix convention.
 * @param {string} raw
 * @returns {{label:string, initial:boolean}}
 */
export function parseNameCell(raw) {
  let rest = raw.trimStart();
  let initial = false;
  if (rest.startsWith("->")) {
    initial = true;
    rest = rest.slice(2);
  }
  return { label: rest.trim(), initial };
}

/** Read-only display equivalent of `nameWithMarkers` (row tooltip), unicode arrow.
 * @param {{label:string, initial:boolean}} state */
export function rowLabel(state) {
  return state.initial ? `→ ${state.label}` : state.label;
}

/** Parses the "Salida" cell's raw typed value: blank means "no output set"
 * (`null`, matches `MooreStateView.output`'s own null-means-unset shape),
 * anything else is used verbatim (trimmed).
 * @param {string} raw @returns {string|null} */
export function parseOutputCell(raw) {
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Target-state labels currently shown in cell (state, inputSymbol) —
 * every edge from `fromId` whose `inputs` carries that symbol (usually one,
 * more than one only under nondeterminism).
 * @param {{from:number, to:number, inputs:string[]}[]} edges
 * @param {number} fromId
 * @param {string} symbol
 * @param {Map<number,string>} labelOf
 */
export function cellValue(edges, fromId, symbol, labelOf) {
  const out = [];
  for (const edge of edges) {
    if (edge.from !== fromId) continue;
    if (edge.inputs.includes(symbol)) out.push(labelOf.get(edge.to));
  }
  return out;
}

/**
 * Compute the `SetTransitions` ops needed so that (state `fromId`,
 * `symbol`)'s set of targets becomes exactly `desiredTargetIds` — add the
 * symbol to every desired target's edge that doesn't already carry it, and
 * strip it from any edge that carried it but is no longer desired. IDs must
 * already be resolved (existing states, or freshly created ones — the
 * caller's job before calling this, same as the FA/Mealy tables').
 * @param {number} fromId
 * @param {string} symbol
 * @param {number[]} desiredTargetIds
 * @param {{from:number, to:number, inputs:string[]}[]} edgesFromState edges where `from === fromId`
 */
export function computeCellUpdateOps(fromId, symbol, desiredTargetIds, edgesFromState) {
  const ops = [];
  const desiredSet = new Set(desiredTargetIds);
  const seenTo = new Set();

  for (const edge of edgesFromState) {
    seenTo.add(edge.to);
    const hasSymbol = edge.inputs.includes(symbol);
    if (desiredSet.has(edge.to)) {
      if (!hasSymbol) {
        ops.push({ op: "SetTransitions", from: fromId, to: edge.to, inputs: [...edge.inputs, symbol] });
      }
    } else if (hasSymbol) {
      ops.push({ op: "SetTransitions", from: fromId, to: edge.to, inputs: edge.inputs.filter((i) => i !== symbol) });
    }
  }

  for (const to of desiredSet) {
    if (!seenTo.has(to)) {
      ops.push({ op: "SetTransitions", from: fromId, to, inputs: [symbol] });
    }
  }

  return ops;
}

/** Parses the table's "Alfabeto de entrada" input into a column list:
 * comma-separated, trimmed, deduped, empty entries skipped — no epsilon
 * promotion: a Moore transition always reads exactly one real input symbol.
 * @param {string} raw
 * @returns {string[]}
 */
export function parseAlphabetInput(raw) {
  const seen = new Set();
  const out = [];
  for (const part of raw.split(",")) {
    const symbol = part.trim();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}
