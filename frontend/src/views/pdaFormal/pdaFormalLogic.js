// Pure logic for the PDA formal-definition view — real JFLAP's PDA 7-tuple
// is M = (Q, Sigma, Gamma, delta, q0, Z0, F). Two things `PdaDoc` genuinely
// does NOT store (see docs/decisions.md, the PDA backend entry):
//  - `Z0` (the initial stack symbol) is a hardcoded simulation-time
//    constant ("Z"), never stored on the document — rendered as an
//    informational comment line only, never parsed back.
//  - `F` (accepting states) genuinely IS stored (`PdaStateMeta.accepting`)
//    — unlike `Z0`, this one's real and round-trips like `q0` does.
//
// `delta` here is a *relation*, not a function (nondeterministic branching
// is normal for a PDA) — one line per transition: `delta(from, input, pop)
// = (to, push)`. Pop/push symbol lists are SPACE-joined in this line format
// (not the diagram's comma-joined display convention) because commas are
// already the argument separator inside `delta(...)`/`(...)` — a
// comma-joined multi-symbol pop/push would be ambiguous with the outer
// argument list.
//
// The one genuinely new sync problem vs. Moore's `planSyncOps`: a parsed
// transition line carries no id at all (unlike Moore's edges, naturally
// keyed by `(from,to)`) — the only identifying information is its full
// `(from,input,pop,push,to)` content tuple. So the sync diffs by
// value-equality of the whole tuple instead of by any stable key: every
// current transition whose tuple isn't in the desired set gets removed,
// every desired tuple not already present gets added. This also means a
// multi-transition-same-(from,to)-pair document round-trips correctly —
// each transition still gets its own independent line/tuple, nothing
// collapses them.

import { EPSILON, parseInputSymbol, parseSymbolList } from "../pdaDiagram/pdaLogic.js";

function formatSymbolListSpaced(symbols) {
  return symbols && symbols.length ? symbols.join(" ") : EPSILON;
}

/**
 * @param {{states:{id:number,label:string,initial:boolean,accepting:boolean}[], transitions:{from:number,to:number,input:string|null,pop:string[],push:string[]}[], derived:{input_alphabet:string[],stack_alphabet:string[]}}} doc
 */
export function formatFormalText({ states, transitions, derived }) {
  const labelOf = new Map(states.map((s) => [s.id, s.label]));
  const initial = states.find((s) => s.initial);
  const accepting = states.filter((s) => s.accepting);

  const lines = [];
  lines.push(`Q = {${states.map((s) => s.label).join(", ")}}`);
  lines.push(`Sigma = {${derived.input_alphabet.join(", ")}}`);
  lines.push(`Gamma = {${derived.stack_alphabet.join(", ")}}`);
  lines.push(`q0 = ${initial ? initial.label : ""}`);
  lines.push(`F = {${accepting.map((s) => s.label).join(", ")}}`);
  lines.push(`# Z0 = "Z" (símbolo inicial de pila, fijo — no se guarda en el documento)`);

  for (const t of transitions) {
    const fromLabel = labelOf.get(t.from);
    const toLabel = labelOf.get(t.to);
    const input = t.input ?? EPSILON;
    const pop = formatSymbolListSpaced(t.pop);
    const push = formatSymbolListSpaced(t.push);
    lines.push(`delta(${fromLabel}, ${input}, ${pop}) = (${toLabel}, ${push})`);
  }

  return lines.join("\n");
}

/**
 * @param {string} text
 * @returns {{ok:true, model:{states:string[], initial:string|null, accepting:string[], transitions:{from:string,input:string|null,pop:string[],to:string,push:string[]}[]}}|{ok:false, error:string}}
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
    if (/^(Sigma|Σ|Gamma|Γ)\s*=/.test(line)) continue; // informational only, not validated
    if ((m = /^q0\s*=\s*(\S*)$/.exec(line))) {
      initial = m[1] || null;
      continue;
    }
    if ((m = /^F\s*=\s*\{(.*)\}$/.exec(line))) {
      accepting = splitList(m[1]);
      continue;
    }
    if (
      (m = /^(?:delta|δ)\(\s*([^,]+?)\s*,\s*([^,]+?)\s*,\s*([^)]+?)\s*\)\s*=\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)$/.exec(
        line,
      ))
    ) {
      const [, from, inputRaw, popRaw, to, pushRaw] = m;
      transitions.push({
        from,
        input: parseInputSymbol(inputRaw === EPSILON ? "" : inputRaw),
        pop: popRaw === EPSILON ? [] : parseSymbolList(popRaw),
        to,
        push: pushRaw === EPSILON ? [] : parseSymbolList(pushRaw),
      });
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
 * those require a live id from the server first (same split as Moore's own
 * `planSyncOps`).
 * @param {{states:string[], initial:string|null, accepting:string[], transitions:{from:string,input:string|null,pop:string[],to:string,push:string[]}[]}} model
 * @param {Map<string, number>} resolvedIdOf
 * @param {{id:number, label:string, initial:boolean, accepting:boolean}[]} currentStates
 * @param {{id:number, from:number, to:number, input:string|null, pop:string[], push:string[]}[]} currentTransitions
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
    input: t.input,
    pop: t.pop,
    push: t.push,
    matched: false,
  }));

  for (const current of currentTransitions) {
    const matchIdx = desired.findIndex(
      (d) =>
        !d.matched &&
        d.from === current.from &&
        d.to === current.to &&
        d.input === current.input &&
        sameList(d.pop, current.pop) &&
        sameList(d.push, current.push),
    );
    if (matchIdx >= 0) {
      desired[matchIdx].matched = true;
    } else {
      ops.push({ op: "RemoveTransition", id: current.id });
    }
  }
  for (const d of desired) {
    if (!d.matched) {
      ops.push({ op: "AddTransition", from: d.from, to: d.to, input: d.input, pop: d.pop, push: d.push });
    }
  }

  return ops;
}

function sameList(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
