// Pure logic for the L1 state-table-view (task 7.5), matching kflap-v0.1's
// table semantics (README): rows = states, columns = Σ, cells = comma-
// separated destination state labels. Editing a cell replaces the FULL
// destination set for that (state, symbol) pair — spec `state-table-view` >
// "Edit transition target in table".
//
// Initial/accepting are no longer separate columns (2026-08-09: removed per
// user request) — they're typed straight into the name cell as a `->`/`*`
// prefix (`parseNameCell`), the same two characters `rowLabel` already used
// to *display* them, now doubling as an edit affordance.

export const EPSILON = "ε";

/** @param {string} raw comma-separated destination labels from a cell */
export function parseCellTargets(raw) {
  const seen = new Set();
  const out = [];
  for (const part of raw.split(",")) {
    const label = part.trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

/**
 * kflap-v0.1 row label convention: `→` prefixes the initial state, `*`
 * prefixes an accepting state (both may combine). Read-only display (row
 * tooltip) — see `nameWithMarkers` for the *editable* equivalent.
 * @param {{label:string, initial:boolean, accepting:boolean}} state
 */
export function rowLabel(state) {
  const initial = state.initial ? "→" : "";
  const accepting = state.accepting ? "*" : "";
  const prefix = initial || accepting ? `${initial}${accepting} ` : "";
  return `${prefix}${state.label}`;
}

/**
 * The name-cell's editable value: ASCII `->`/`*` prefixes (no space), in
 * that order, immediately before the label — chosen so it round-trips
 * exactly through `parseNameCell` (typing what's shown reproduces the same
 * state). Distinct from `rowLabel`, which uses the unicode `→` glyph plus a
 * space and is read-only display, not something re-typed back.
 * @param {{label:string, initial:boolean, accepting:boolean}} state
 */
export function nameWithMarkers(state) {
  return `${state.initial ? "->" : ""}${state.accepting ? "*" : ""}${state.label}`;
}

/**
 * Parses a name-cell's raw typed value for the `->`/`*` prefix convention —
 * typing `->` at the start marks the state initial, `*` marks it accepting,
 * either order, optionally separated by whitespace (`"->*q0"`, `"* ->q0"`,
 * `"*q0"`, `"->q0"`, `"q0"`). The caller decides what a *missing* prefix on
 * a previously-initial/accepting state means (clear the flag) — this
 * function only reports what's textually present.
 * @param {string} raw
 * @returns {{label:string, initial:boolean, accepting:boolean}}
 */
export function parseNameCell(raw) {
  let rest = raw;
  let initial = false;
  let accepting = false;
  let matched = true;
  while (matched) {
    matched = false;
    rest = rest.trimStart();
    if (rest.startsWith("->")) {
      initial = true;
      rest = rest.slice(2);
      matched = true;
    } else if (rest.startsWith("*")) {
      accepting = true;
      rest = rest.slice(1);
      matched = true;
    }
  }
  return { label: rest.trim(), initial, accepting };
}

/**
 * Full destination-label list currently shown in cell (state, symbol),
 * matching the table's own display convention.
 * @param {{from:number, to:number, epsilon:boolean, symbols:string[]}[]} edges
 * @param {number} fromId
 * @param {string} symbol
 * @param {Map<number,string>} labelOf
 */
export function cellValue(edges, fromId, symbol, labelOf) {
  const isEpsilon = symbol === EPSILON;
  return edges
    .filter((e) => e.from === fromId && (isEpsilon ? e.epsilon : e.symbols.includes(symbol)))
    .map((e) => labelOf.get(e.to))
    .filter(Boolean);
}

/**
 * Compute the `SetEdge` ops needed so that (state `fromId`, `symbol`)'s
 * destination set becomes exactly `targetIds` — i.e. add `symbol` to any
 * edge newly listed, and strip it from any edge that used to carry it but
 * is no longer a target. IDs must already be resolved (existing states, or
 * freshly created ones — task 7.5/spec "Auto-Create State on Type" is the
 * caller's job before calling this).
 * @param {number} fromId
 * @param {string} symbol
 * @param {number[]} targetIds
 * @param {{from:number, to:number, epsilon:boolean, symbols:string[]}[]} edgesFromState edges where `from === fromId`
 */
export function computeCellUpdateOps(fromId, symbol, targetIds, edgesFromState) {
  const isEpsilon = symbol === EPSILON;
  const targetSet = new Set(targetIds);
  const ops = [];
  const byTo = new Map(edgesFromState.map((e) => [e.to, e]));

  const hasSymbol = (edge) => (isEpsilon ? edge.epsilon : edge.symbols.includes(symbol));

  // Strip the symbol from edges that carried it but are no longer targets.
  for (const edge of edgesFromState) {
    if (hasSymbol(edge) && !targetSet.has(edge.to)) {
      ops.push(withoutSymbol(fromId, edge, symbol, isEpsilon));
    }
  }

  // Add the symbol to every target that doesn't already carry it.
  for (const to of targetIds) {
    const edge = byTo.get(to);
    if (!edge || !hasSymbol(edge)) {
      ops.push(withSymbol(fromId, to, edge, symbol, isEpsilon));
    }
  }

  return ops;
}

/** Parses the table's "Alfabeto" input into a column list: comma-separated,
 * deduped. There is no more always-present `ε` column (2026-08-09: removed
 * per user request, "que no aparezca a menos que se indique dentro del
 * alfabeto") — it only shows up if the user explicitly asks for it, either
 * by typing the literal `ε` character or by leaving one comma-separated
 * entry as pure whitespace (e.g. `"a, ,b"`), which reads as "cadena vacía"
 * once it becomes a column (see `TableView._render`). A truly *empty*
 * entry (`"a,,b"` — nothing at all between the commas, not even a space) is
 * just a stray comma and is silently skipped, not treated as a request for
 * the epsilon column — that's the one deliberate distinction a `.trim()`
 * alone can't make, so trimming happens per-part here instead of via a
 * blanket falsy check.
 * @param {string} raw
 * @returns {string[]}
 */
export function parseAlphabetInput(raw) {
  const seen = new Set();
  const out = [];
  for (const part of raw.split(",")) {
    if (part === "") continue;
    const trimmed = part.trim();
    const symbol = trimmed === "" ? EPSILON : trimmed;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}

function withoutSymbol(fromId, edge, symbol, isEpsilon) {
  return {
    op: "SetEdge",
    from: fromId,
    to: edge.to,
    epsilon: isEpsilon ? false : edge.epsilon,
    symbols: isEpsilon ? edge.symbols : edge.symbols.filter((s) => s !== symbol),
  };
}

function withSymbol(fromId, to, edge, symbol, isEpsilon) {
  const symbols = edge ? [...edge.symbols] : [];
  if (!isEpsilon && !symbols.includes(symbol)) symbols.push(symbol);
  return {
    op: "SetEdge",
    from: fromId,
    to,
    epsilon: isEpsilon ? true : (edge?.epsilon ?? false),
    symbols,
  };
}
