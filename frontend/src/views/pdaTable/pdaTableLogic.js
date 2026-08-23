// Pure logic for the PDA "Tabla de estados" view's Transiciones sub-table —
// PDA transitions are individually addressable (a flat list keyed by id,
// not grouped by (from,to) like Mealy/Moore's edges), so unlike those
// tables' Q x Sigma grid, this is a flat one-row-per-transition table
// instead. State rows reuse `views/table/tableLogic.js`'s `nameWithMarkers`/
// `parseNameCell`/`rowLabel` directly (PDA has both initial AND accepting,
// exactly FA's shape, unlike Moore's initial-only one) — nothing PDA-
// specific to add there, so no duplicate versions live in this module.

import { parseInputSymbol, parseSymbolList } from "../pdaDiagram/pdaLogic.js";

/**
 * Build the `EditTransition` op for editing one field (`input`|`pop`|`push`)
 * of an existing transition — the other two fields keep their current
 * value, since `EditTransition` always replaces the whole payload (see
 * `PdaEditOp::EditTransition`'s doc comment). Returns `null` if the parsed
 * value is unchanged (no-op edit, same "don't apply a no-op" discipline as
 * Moore's table).
 * @param {{id:number, input:string|null, pop:string[], push:string[]}} transition
 * @param {"input"|"pop"|"push"} field
 * @param {string} raw
 */
export function computeFieldEditOp(transition, field, raw) {
  const next = { input: transition.input, pop: transition.pop, push: transition.push };
  if (field === "input") next.input = parseInputSymbol(raw);
  else next[field] = parseSymbolList(raw);

  const unchanged =
    next.input === transition.input && sameList(next.pop, transition.pop) && sameList(next.push, transition.push);
  if (unchanged) return null;
  return { op: "EditTransition", id: transition.id, input: next.input, pop: next.pop, push: next.push };
}

/**
 * Re-targeting `from`/`to` isn't a plain field edit — endpoints are
 * immutable on `EditTransition` (see its doc comment: "moving a
 * transition's endpoints is a remove + add, not an edit"). Returns the two
 * ops in apply order, or `null` if the endpoint didn't actually change.
 * @param {{id:number, from:number, to:number, input:string|null, pop:string[], push:string[]}} transition
 * @param {"from"|"to"} field
 * @param {number} newStateId
 */
export function computeRetargetOps(transition, field, newStateId) {
  if (transition[field] === newStateId) return null;
  const next = { from: transition.from, to: transition.to };
  next[field] = newStateId;
  return [
    { op: "RemoveTransition", id: transition.id },
    {
      op: "AddTransition",
      from: next.from,
      to: next.to,
      input: transition.input,
      pop: transition.pop,
      push: transition.push,
    },
  ];
}

/**
 * Build the `AddTransition` op for the table's "+ Agregar transición" row.
 * `from`/`to` must already be resolved to live state ids (the row's two
 * `<select>`s, populated from `docStore.getStates()` — no auto-create, a
 * transition always connects existing states, unlike a table cell's
 * "type a new label" convention in Mealy/Moore's grids). Returns `null` if
 * either endpoint is missing (e.g. the document has no states yet).
 * @param {{from:number|null, to:number|null, input:string, pop:string, push:string}} raw
 */
export function computeAddTransitionOp(raw) {
  if (raw.from == null || raw.to == null) return null;
  return {
    op: "AddTransition",
    from: raw.from,
    to: raw.to,
    input: parseInputSymbol(raw.input),
    pop: parseSymbolList(raw.pop),
    push: parseSymbolList(raw.push),
  };
}

function sameList(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
