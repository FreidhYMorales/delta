// Pure logic for the Moore formal-definition view — mirrors
// `mealyFormal/mealyFormalLogic.js`'s render/parse/sync shape for the
// Moore 6-tuple M = (Q, Sigma, Delta, delta, lambda, q0) instead of
// Mealy's M = (Q, Sigma, Delta, delta, lambda, q0)-with-delta-carrying-
// output: here `delta` and `lambda` are genuinely two separate functions
// (delta: Q x Sigma -> Q, lambda: Q -> Delta) because Moore's output lives
// on the state, not the edge — so they get two separate line shapes
// (`delta(from, input) = to` and `lambda(state) = output`) instead of
// Mealy's single combined `delta(from,input)=to/output` line.

/**
 * @param {{states:{id:number,label:string,initial:boolean,output:string|null}[], edges:{from:number,to:number,inputs:string[]}[], derived:{input_alphabet:string[],output_alphabet:string[]}}} doc
 */
export function formatFormalText({ states, edges, derived }) {
  const labelOf = new Map(states.map((s) => [s.id, s.label]));
  const initial = states.find((s) => s.initial);

  const lines = [];
  lines.push(`Q = {${states.map((s) => s.label).join(", ")}}`);
  lines.push(`Sigma = {${derived.input_alphabet.join(", ")}}`);
  lines.push(`Delta = {${derived.output_alphabet.join(", ")}}`);
  lines.push(`q0 = ${initial ? initial.label : ""}`);

  for (const edge of edges) {
    const fromLabel = labelOf.get(edge.from);
    const toLabel = labelOf.get(edge.to);
    for (const input of edge.inputs) {
      lines.push(`delta(${fromLabel}, ${input}) = ${toLabel}`);
    }
  }

  for (const state of states) {
    if (state.output != null) lines.push(`lambda(${state.label}) = ${state.output}`);
  }

  return lines.join("\n");
}

/**
 * @param {string} text
 * @returns {{ok:true, model:{states:string[], initial:string|null, transitions:{from:string,input:string,to:string}[], outputs:{state:string,output:string}[]}}|{ok:false, error:string}}
 */
export function parseFormalText(text) {
  let states = null;
  let initial = null;
  const transitions = [];
  const outputs = [];

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
    if ((m = /^(?:delta|δ)\(([^,]+),([^)]*)\)\s*=\s*(.+)$/.exec(line))) {
      const from = m[1].trim();
      const input = m[2].trim();
      const to = m[3].trim();
      transitions.push({ from, input, to });
      continue;
    }
    if ((m = /^(?:lambda|λ)\(([^)]*)\)\s*=\s*(.*)$/.exec(line))) {
      const state = m[1].trim();
      const output = m[2].trim();
      outputs.push({ state, output });
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
  }
  for (const o of outputs) {
    if (!declared.has(o.state)) return { ok: false, error: `Undeclared state: "${o.state}"` };
    if (!o.output) return { ok: false, error: `Missing output symbol: "lambda(${o.state}) = "` };
  }

  return { ok: true, model: { states, initial, transitions, outputs } };
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
 * Compute `SetInitial`/`SetTransitions`/`SetOutput` ops that make the
 * document match `model`, given every referenced label is already
 * resolvable to an id. Deliberately excludes `AddState`/`RemoveState` —
 * those require a live id from the server first (same split as the FA/Mealy
 * formal views' `planSyncOps`).
 * @param {{states:string[], initial:string|null, transitions:{from:string,input:string,to:string}[], outputs:{state:string,output:string}[]}} model
 * @param {Map<string, number>} resolvedIdOf
 * @param {{id:number, label:string, initial:boolean, output:string|null}[]} currentStates
 * @param {{from:number, to:number, inputs:string[]}[]} currentEdges
 */
export function planSyncOps(model, resolvedIdOf, currentStates, currentEdges) {
  const ops = [];
  const initialId = model.initial != null ? resolvedIdOf.get(model.initial) : null;
  const currentInitial = currentStates.find((s) => s.initial);
  if ((currentInitial?.id ?? null) !== (initialId ?? null)) {
    ops.push({ op: "SetInitial", id: initialId ?? null });
  }

  const desiredEdges = new Map(); // `${from}:${to}` -> [input][]
  for (const t of model.transitions) {
    const from = resolvedIdOf.get(t.from);
    const to = resolvedIdOf.get(t.to);
    const key = `${from}:${to}`;
    if (!desiredEdges.has(key)) desiredEdges.set(key, { from, to, inputs: [] });
    desiredEdges.get(key).inputs.push(t.input);
  }

  const currentByKey = new Map(currentEdges.map((e) => [`${e.from}:${e.to}`, e]));
  const allEdgeKeys = new Set([...desiredEdges.keys(), ...currentByKey.keys()]);
  for (const key of allEdgeKeys) {
    const desired = desiredEdges.get(key) ?? { ...splitKey(key), inputs: [] };
    const current = currentByKey.get(key);
    if (!sameInputs(current?.inputs ?? [], desired.inputs)) {
      ops.push({ op: "SetTransitions", from: desired.from, to: desired.to, inputs: desired.inputs });
    }
  }

  const outputByLabel = new Map(model.outputs.map((o) => [o.state, o.output]));
  for (const label of model.states) {
    const id = resolvedIdOf.get(label);
    const current = currentStates.find((s) => s.id === id);
    const desiredOutput = outputByLabel.get(label) ?? null;
    if ((current?.output ?? null) !== desiredOutput) {
      ops.push({ op: "SetOutput", state: id, output: desiredOutput });
    }
  }

  return ops;
}

function splitKey(key) {
  const [from, to] = key.split(":").map(Number);
  return { from, to };
}

function sameInputs(a, b) {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((i) => sa.has(i));
}
