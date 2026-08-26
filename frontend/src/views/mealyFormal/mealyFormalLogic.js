// Pure logic for the Mealy formal-definition view — mirrors
// `views/formal/formalLogic.js`'s render/parse/sync shape for the Mealy
// 6-tuple M = (Q, Sigma, Delta, delta, lambda, q0) instead of AFD/AFN's
// M = (Q, Sigma, delta, q0, F): no F (Mealy has no accepting states), and
// one combined `delta(from, input) = to/output` line per transition rather
// than two separate delta/lambda functions — the same compact
// "input/output" pairing already used by the diagram's transition prompt
// and the state table's cells (`mealyDiagram/mealyLogic.js`,
// `mealyTable/mealyTableLogic.js`), kept consistent across all three
// Mealy editors instead of introducing a fourth notation.

/**
 * @param {{states:{id:number,label:string,initial:boolean}[], edges:{from:number,to:number,transitions:[string,string][]}[], derived:{input_alphabet:string[],output_alphabet:string[]}}} doc
 */
export function formatFormalText({ states, edges, derived }) {
  const labelOf = new Map(states.map((s) => [s.id, s.label]));
  const initial = states.find((s) => s.initial);

  const lines = [];
  lines.push(`Q = {${states.map((s) => s.label).join(", ")}}`);
  lines.push(`Σ = {${derived.input_alphabet.join(", ")}}`);
  lines.push(`Δ = {${derived.output_alphabet.join(", ")}}`);
  lines.push(`q0 = ${initial ? initial.label : ""}`);

  for (const edge of edges) {
    const fromLabel = labelOf.get(edge.from);
    const toLabel = labelOf.get(edge.to);
    for (const [input, output] of edge.transitions) {
      lines.push(`δ(${fromLabel}, ${input}) = ${toLabel}/${output}`);
    }
  }

  return lines.join("\n");
}

/**
 * @param {string} text
 * @returns {{ok:true, model:{states:string[], initial:string|null, transitions:{from:string,input:string,to:string,output:string}[]}}|{ok:false, error:string}}
 */
export function parseFormalText(text) {
  let states = null;
  let initial = null;
  const transitions = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    let m;
    if ((m = /^Q\s*=\s*\{(.*)\}$/.exec(line))) {
      states = splitList(m[1]);
      continue;
    }
    if (/^(Sigma|Σ|Delta|Δ)\s*=/.test(line)) continue; // informational only, not validated
    if ((m = /^q0\s*=\s*(\S*)$/.exec(line))) {
      initial = m[1] || null;
      continue;
    }
    if ((m = /^delta\(([^,]+),([^)]*)\)\s*=\s*(.+)$/.exec(line) || /^δ\(([^,]+),([^)]*)\)\s*=\s*(.+)$/.exec(line))) {
      const from = m[1].trim();
      const input = m[2].trim();
      const rhs = m[3].trim();
      const idx = rhs.indexOf("/");
      if (idx === -1) {
        return { ok: false, error: `Missing output in transition: "${line}" (expected "to/output")` };
      }
      const to = rhs.slice(0, idx).trim();
      const output = rhs.slice(idx + 1).trim();
      transitions.push({ from, input, to, output });
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
  for (const t of transitions) {
    if (!declared.has(t.from)) return { ok: false, error: `Undeclared state: "${t.from}"` };
    if (!declared.has(t.to)) return { ok: false, error: `Undeclared state: "${t.to}"` };
    if (!t.input) return { ok: false, error: `Missing input symbol: "delta(${t.from}, ) = ..."` };
    if (!t.output) return { ok: false, error: `Missing output symbol: "delta(${t.from}, ${t.input}) = ${t.to}/"` };
  }

  return { ok: true, model: { states, initial, transitions } };
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
 * Compute `SetInitial`/`SetTransitions` ops that make the document match
 * `model`, given every referenced label is already resolvable to an id.
 * Deliberately excludes `AddState`/`RemoveState` — those require a live id
 * from the server first (same split as the FA formal view's `planSyncOps`).
 * @param {{states:string[], initial:string|null, transitions:{from:string,input:string,to:string,output:string}[]}} model
 * @param {Map<string, number>} resolvedIdOf
 * @param {{id:number, label:string, initial:boolean}[]} currentStates
 * @param {{from:number, to:number, transitions:[string,string][]}[]} currentEdges
 */
export function planSyncOps(model, resolvedIdOf, currentStates, currentEdges) {
  const ops = [];
  const initialId = model.initial != null ? resolvedIdOf.get(model.initial) : null;
  const currentInitial = currentStates.find((s) => s.initial);
  if ((currentInitial?.id ?? null) !== (initialId ?? null)) {
    ops.push({ op: "SetInitial", id: initialId ?? null });
  }

  const desiredEdges = new Map(); // `${from}:${to}` -> [input,output][]
  for (const t of model.transitions) {
    const from = resolvedIdOf.get(t.from);
    const to = resolvedIdOf.get(t.to);
    const key = `${from}:${to}`;
    if (!desiredEdges.has(key)) desiredEdges.set(key, { from, to, entries: [] });
    desiredEdges.get(key).entries.push([t.input, t.output]);
  }

  const currentByKey = new Map(currentEdges.map((e) => [`${e.from}:${e.to}`, e]));
  const allKeys = new Set([...desiredEdges.keys(), ...currentByKey.keys()]);
  for (const key of allKeys) {
    const desired = desiredEdges.get(key) ?? { ...splitKey(key), entries: [] };
    const current = currentByKey.get(key);
    if (!sameEntries(current?.transitions ?? [], desired.entries)) {
      ops.push({ op: "SetTransitions", from: desired.from, to: desired.to, entries: desired.entries });
    }
  }

  return ops;
}

function splitKey(key) {
  const [from, to] = key.split(":").map(Number);
  return { from, to };
}

function sameEntries(a, b) {
  if (a.length !== b.length) return false;
  const sa = new Set(a.map(([i, o]) => `${i}/${o}`));
  return b.every(([i, o]) => sa.has(`${i}/${o}`));
}
