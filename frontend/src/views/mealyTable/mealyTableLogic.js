// Pure logic for the Mealy state-table view — same role as
// `views/table/tableLogic.js` but genuinely separate rather than a shared
// module: a Mealy cell pairs a next-state with an output per input symbol
// (`"q1/x"`), there's no accepting flag (only `->` marks the initial
// state, no `*`), and there's no epsilon column (a Mealy transition always
// reads exactly one input symbol). Reuses `parseTransitionPrompt`'s sibling
// helpers from `mealyDiagram/mealyLogic.js` where the shape genuinely
// matches (nothing here — table cells parse `target/output`, the diagram's
// prompt parses `input/output`; same "x/y" shape, different meaning, so
// they're NOT the same function despite looking alike).

import { applyGreekSymbols } from "../../store/greekSymbols.js";

/** @param {string} raw comma-separated `target/output` pairs, e.g. "q1/x, q2/y" */
export function parseCellEntries(raw) {
  const out = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("/");
    if (idx === -1) continue; // malformed pair (no output given) — skipped, not rejected
    const label = trimmed.slice(0, idx).trim();
    const output = trimmed.slice(idx + 1).trim();
    if (!label || !output) continue;
    out.push({ label, output });
  }
  return out;
}

/**
 * The name-cell's editable value: `->` prefix (no `*` — Mealy has no
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

/**
 * `target/output` pairs currently shown in cell (state, inputSymbol) —
 * every edge from `fromId` carrying an entry for that input symbol (usually
 * one, more than one only under nondeterminism).
 * @param {{from:number, to:number, transitions:[string,string][]}[]} edges
 * @param {number} fromId
 * @param {string} symbol
 * @param {Map<number,string>} labelOf
 */
export function cellValue(edges, fromId, symbol, labelOf) {
  const out = [];
  for (const edge of edges) {
    if (edge.from !== fromId) continue;
    for (const [input, output] of edge.transitions) {
      if (input === symbol) out.push(`${labelOf.get(edge.to)}/${output}`);
    }
  }
  return out;
}

/**
 * Compute the `SetTransitions` ops needed so that (state `fromId`,
 * `symbol`)'s set of `(target, output)` pairs becomes exactly `desired` —
 * add/update the symbol's entry on every target edge, and strip it from any
 * edge that carried it but is no longer desired. IDs must already be
 * resolved (existing states, or freshly created ones — the caller's job
 * before calling this, same as the FA table's `computeCellUpdateOps`).
 * @param {number} fromId
 * @param {string} symbol
 * @param {{to:number, output:string}[]} desired
 * @param {{from:number, to:number, transitions:[string,string][]}[]} edgesFromState edges where `from === fromId`
 */
export function computeCellUpdateOps(fromId, symbol, desired, edgesFromState) {
  const ops = [];
  const desiredByTo = new Map(desired.map((d) => [d.to, d.output]));
  const seenTo = new Set();

  for (const edge of edgesFromState) {
    seenTo.add(edge.to);
    const hasSymbol = edge.transitions.some(([input]) => input === symbol);
    if (desiredByTo.has(edge.to)) {
      const output = desiredByTo.get(edge.to);
      const current = edge.transitions.find(([input]) => input === symbol);
      if (!current || current[1] !== output) {
        const entries = edge.transitions.filter(([input]) => input !== symbol);
        entries.push([symbol, output]);
        ops.push({ op: "SetTransitions", from: fromId, to: edge.to, entries });
      }
    } else if (hasSymbol) {
      const entries = edge.transitions.filter(([input]) => input !== symbol);
      ops.push({ op: "SetTransitions", from: fromId, to: edge.to, entries });
    }
  }

  for (const { to, output } of desired) {
    if (!seenTo.has(to)) {
      ops.push({ op: "SetTransitions", from: fromId, to, entries: [[symbol, output]] });
    }
  }

  return ops;
}

/** Parses the table's "Alfabeto de entrada" input into a column list:
 * comma-separated, trimmed, deduped, empty entries skipped — no epsilon
 * promotion (unlike the FA table's `parseAlphabetInput`): a Mealy
 * transition always reads exactly one real input symbol.
 * @param {string} raw
 * @returns {string[]}
 */
export function parseAlphabetInput(raw) {
  const seen = new Set();
  const out = [];
  for (const part of raw.split(",")) {
    const symbol = applyGreekSymbols(part.trim());
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}
