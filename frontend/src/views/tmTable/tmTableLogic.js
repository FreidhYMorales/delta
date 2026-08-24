// Pure logic for the TM "Tabla de estados" view's Transiciones sub-table —
// mirrors `pdaTable/pdaTableLogic.js`'s shape exactly (a flat,
// individually-addressable list keyed by id, not a Q x Sigma grid), adapted
// for TM's variable per-transition tape count: a transition carries
// `tapes: {read,write,direction}[]`, one entry per tape (1 to 5,
// `TmDoc::tape_count`, locked by the first transition ever added — see
// `tmDiagram/tmLogic.js`'s `effectiveTapeCount`), instead of PDA's fixed
// three fields (input/pop/push). State rows reuse `views/table/tableLogic.js`'s
// `nameWithMarkers`/`parseNameCell`/`rowLabel` directly (TM has both initial
// AND accepting, exactly PDA's shape) — nothing TM-specific to add there.

import { parseTapeOpText } from "../tmDiagram/tmLogic.js";

/**
 * Array-of-tape-op equality — `read`/`write`/`direction` all equal at every
 * index. Deliberately NOT `pdaTableLogic.js`'s `sameList` (that's for a flat
 * string array; tapes are an array of objects).
 * @param {{read:string,write:string,direction:string}[]} a
 * @param {{read:string,write:string,direction:string}[]} b
 */
export function sameTapes(a, b) {
  if (a.length !== b.length) return false;
  return a.every((t, i) => t.read === b[i].read && t.write === b[i].write && t.direction === b[i].direction);
}

/**
 * Build the `EditTransition` op for editing a single tape's cell — the
 * other tapes keep their current value, since `EditTransition` always
 * replaces the whole `tapes` payload (see `TmEditOpDto::EditTransition`'s
 * doc comment, same "no partial-field replace" rule as PDA's). Returns
 * `null` if the parsed value is unchanged (no-op edit, same discipline as
 * PDA's `computeFieldEditOp`).
 * @param {{id:number, tapes:{read:string,write:string,direction:string}[]}} transition
 * @param {number} tapeIndex
 * @param {string} raw
 */
export function computeTapeFieldEditOp(transition, tapeIndex, raw) {
  const nextTape = parseTapeOpText(raw);
  const nextTapes = transition.tapes.map((t, i) => (i === tapeIndex ? nextTape : t));
  if (sameTapes(nextTapes, transition.tapes)) return null;
  return { op: "EditTransition", id: transition.id, tapes: nextTapes };
}

/**
 * Re-targeting `from`/`to` isn't a plain field edit — endpoints are
 * immutable on `EditTransition` (a moved endpoint is remove+add, same as
 * PDA's own `computeRetargetOps`). Returns the two ops in apply order, or
 * `null` if the endpoint didn't actually change.
 * @param {{id:number, from:number, to:number, tapes:{read:string,write:string,direction:string}[]}} transition
 * @param {"from"|"to"} field
 * @param {number} newStateId
 */
export function computeRetargetOps(transition, field, newStateId) {
  if (transition[field] === newStateId) return null;
  const next = { from: transition.from, to: transition.to };
  next[field] = newStateId;
  return [
    { op: "RemoveTransition", id: transition.id },
    { op: "AddTransition", from: next.from, to: next.to, tapes: transition.tapes },
  ];
}

/**
 * Build the `AddTransition` op for the table's "+ Agregar transición" row.
 * `from`/`to` must already be resolved to live state ids (the row's two
 * `<select>`s, populated from `docStore.getStates()` — no auto-create, same
 * as PDA's). Returns `null` if either endpoint is missing.
 * @param {{from:number|null, to:number|null, tapeTexts:string[]}} raw
 */
export function computeAddTransitionOp(raw) {
  if (raw.from == null || raw.to == null) return null;
  return {
    op: "AddTransition",
    from: raw.from,
    to: raw.to,
    tapes: raw.tapeTexts.map((text) => parseTapeOpText(text)),
  };
}
