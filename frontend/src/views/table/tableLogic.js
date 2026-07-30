// Pure logic for the L1 state-table-view (task 7.5), matching kflap-v0.1's
// table semantics (README): rows = states (`→` initial, `*` accepting
// markers), columns = Σ (+ a fixed `ε` column), cells = comma-separated
// destination state labels. Editing a cell replaces the FULL destination
// set for that (state, symbol) pair — spec `state-table-view` > "Edit
// transition target in table".

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
 * prefixes an accepting state (both may combine).
 * @param {{label:string, initial:boolean, accepting:boolean}} state
 */
export function rowLabel(state) {
  const initial = state.initial ? "→" : "";
  const accepting = state.accepting ? "*" : "";
  const prefix = initial || accepting ? `${initial}${accepting} ` : "";
  return `${prefix}${state.label}`;
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
