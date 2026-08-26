// Pure logic for the TM formal-definition view. Real JFLAP's TM tuple is
// M = (Q, Gamma, delta, q0, F) — simpler than PDA's 7-tuple: `TmDoc` has no
// separate input/stack alphabet split, just one combined `alphabet`
// (`TmDerived.alphabet`, the tape alphabet including any explicitly-used
// blank). This module names that line `Gamma`, not `Sigma` — this project's
// own naming choice (not verified from decompiled JFLAP), chosen because
// "tape alphabet" is the more honest name for a combined alphabet that can
// include the blank glyph, unlike an "input alphabet" which normally
// wouldn't.
//
// `# Cintas = N` is an informational comment line, never parsed back into
// anything actionable — but unlike PDA's `# Z0 = ...` comment (genuinely NOT
// stored anywhere in `PdaDoc`, a hardcoded runtime constant), TM's
// `tape_count` IS real stored/derived document state (`TmDerived.tape_count`).
// It's a comment here not because it doesn't exist, but because it's
// derived/locked by the transitions themselves (`TmDoc::tape_count`, locked
// by the first transition ever added, `model::tm.rs`) rather than being an
// independently settable fact the formal text could set.
//
// Delta line format reuses `tmDiagram/tmLogic.js`'s `formatTransitionLabel`
// directly: `delta(from, {read};{write},{direction} | ...) = to`, so what's
// shown here for one transition is character-for-character the same string
// shown on the diagram's edge label.
//
// Same sync problem as PDA's `planSyncOps`: a parsed transition line carries
// no id (only `(from,to,tapes)` identifies it), so the sync diffs by
// value-equality of the whole tuple instead of by any stable key.

import { formatTransitionLabel, parseTapeOpText } from "../tmDiagram/tmLogic.js";
import { sameTapes } from "../tmTable/tmTableLogic.js";

const DELTA_LINE_RE = /^(?:delta|δ)\(([^,]+),\s*(.+)\)\s*=\s*(.+)$/;

/**
 * @param {{states:{id:number,label:string,initial:boolean,accepting:boolean}[], transitions:{from:number,to:number,tapes:{read:string,write:string,direction:string}[]}[], derived:{alphabet:string[],tape_count:number}}} doc
 */
export function formatFormalText({ states, transitions, derived }) {
  const labelOf = new Map(states.map((s) => [s.id, s.label]));
  const initial = states.find((s) => s.initial);
  const accepting = states.filter((s) => s.accepting);

  const lines = [];
  lines.push(`Q = {${states.map((s) => s.label).join(", ")}}`);
  lines.push(`Γ = {${derived.alphabet.join(", ")}}`);
  lines.push(`q0 = ${initial ? initial.label : ""}`);
  lines.push(`F = {${accepting.map((s) => s.label).join(", ")}}`);
  lines.push(
    `# Cintas = ${derived.tape_count} (cantidad de cintas — fijada por la primera transición del documento, no se puede cambiar acá)`,
  );

  for (const t of transitions) {
    const fromLabel = labelOf.get(t.from);
    const toLabel = labelOf.get(t.to);
    lines.push(`δ(${fromLabel}, ${formatTransitionLabel(t.tapes)}) = ${toLabel}`);
  }

  return lines.join("\n");
}

/**
 * @param {string} text
 * @returns {{ok:true, model:{states:string[], initial:string|null, accepting:string[], transitions:{from:string,to:string,tapes:{read:string,write:string,direction:string}[]}[]}}|{ok:false, error:string}}
 */
export function parseFormalText(text) {
  let states = null;
  let initial = null;
  let accepting = null;
  const transitions = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    let m;
    if ((m = /^Q\s*=\s*\{(.*)\}$/.exec(line))) {
      states = splitList(m[1]);
      continue;
    }
    if (/^(Gamma|Γ)\s*=/.test(line)) continue; // informational only, not validated
    if ((m = /^q0\s*=\s*(\S*)$/.exec(line))) {
      initial = m[1] || null;
      continue;
    }
    if ((m = /^F\s*=\s*\{(.*)\}$/.exec(line))) {
      accepting = splitList(m[1]);
      continue;
    }
    if ((m = DELTA_LINE_RE.exec(line))) {
      const [, fromRaw, tapesBlob, toRaw] = m;
      const from = fromRaw.trim();
      const to = toRaw.trim();
      const tapes = tapesBlob.split(" | ").map((piece) => parseTapeOpText(piece.trim()));
      transitions.push({ from, to, tapes });
      continue;
    }
    return { ok: false, error: `Unrecognized line: "${line}"` };
  }

  if (states == null) {
    return { ok: false, error: "Missing Q declaration (Q = {...})" };
  }
  const declared = new Set(states);

  if (initial != null && !declared.has(initial)) {
    return { ok: false, error: `Undeclared state in q0: "${initial}"` };
  }
  const acceptingList = accepting ?? [];
  for (const a of acceptingList) {
    if (!declared.has(a)) return { ok: false, error: `Undeclared state in F: "${a}"` };
  }
  for (const t of transitions) {
    if (!declared.has(t.from)) return { ok: false, error: `Undeclared state: "${t.from}"` };
    if (!declared.has(t.to)) return { ok: false, error: `Undeclared state: "${t.to}"` };
  }

  return { ok: true, model: { states, initial, accepting: acceptingList, transitions } };
}

function splitList(raw) {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {string[]} modelStateLabels
 * @param {{id:number, label:string}[]} currentStates
 */
export function planStateDiff(modelStateLabels, currentStates) {
  const currentLabels = new Set(currentStates.map((s) => s.label));
  const modelLabels = new Set(modelStateLabels);
  return {
    toAddLabels: modelStateLabels.filter((l) => !currentLabels.has(l)),
    toRemoveIds: currentStates.filter((s) => !modelLabels.has(s.label)).map((s) => s.id),
  };
}

/**
 * Compute `SetInitial`/`SetAccepting`/transition-diff ops that make the
 * document match `model`, given every referenced label is already
 * resolvable to an id. Deliberately excludes `AddState`/`RemoveState` —
 * those require a live id from the server first (same split as PDA's own
 * `planSyncOps`).
 * @param {{states:string[], initial:string|null, accepting:string[], transitions:{from:string,to:string,tapes:{read:string,write:string,direction:string}[]}[]}} model
 * @param {Map<string, number>} resolvedIdOf
 * @param {{id:number, label:string, initial:boolean, accepting:boolean}[]} currentStates
 * @param {{id:number, from:number, to:number, tapes:{read:string,write:string,direction:string}[]}[]} currentTransitions
 */
export function planSyncOps(model, resolvedIdOf, currentStates, currentTransitions) {
  const ops = [];

  const initialId = model.initial != null ? resolvedIdOf.get(model.initial) : null;
  const currentInitial = currentStates.find((s) => s.initial);
  if ((currentInitial?.id ?? null) !== (initialId ?? null)) {
    ops.push({ op: "SetInitial", id: initialId ?? null });
  }

  const acceptingIds = new Set(model.accepting.map((label) => resolvedIdOf.get(label)));
  for (const state of currentStates) {
    const desired = acceptingIds.has(state.id);
    if (state.accepting !== desired) {
      ops.push({ op: "SetAccepting", id: state.id, accepting: desired });
    }
  }

  const desired = model.transitions.map((t) => ({
    from: resolvedIdOf.get(t.from),
    to: resolvedIdOf.get(t.to),
    tapes: t.tapes,
    matched: false,
  }));

  for (const current of currentTransitions) {
    const matchIdx = desired.findIndex(
      (d) => !d.matched && d.from === current.from && d.to === current.to && sameTapes(d.tapes, current.tapes),
    );
    if (matchIdx >= 0) {
      desired[matchIdx].matched = true;
    } else {
      ops.push({ op: "RemoveTransition", id: current.id });
    }
  }
  for (const d of desired) {
    if (!d.matched) {
      ops.push({ op: "AddTransition", from: d.from, to: d.to, tapes: d.tapes });
    }
  }

  return ops;
}
