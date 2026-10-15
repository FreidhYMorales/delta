// Pure (DOM-free) NFA-ε -> DFA conversion laid out the way it is worked by
// hand, in three tables:
//   1. ε-closures: every state as {itself}U{what it reaches through ε}.
//   2. NFA-ε transitions: an E column (that same closure, minus the state)
//      and one column per symbol with the state's direct moves.
//   3. Transitions without ε (subset construction): starting from the
//      initial state's closure, every cell is {moved}U{added by closure}
//      = qN, where qN names that closure set in discovery order. An empty
//      move leaves the cell empty (no dead state).
// The initial state stays the same; the accepting DFA states are the sets
// that contain an original accepting state. `dfa` is the resulting
// automaton in `applyAutomatonModel`'s label-addressed model shape, named
// exactly as table 3 names it.

const INITIAL_MARK = "→ ";
const ACCEPTING_MARK = "*";

const byLabel = (a, b) => a.label.localeCompare(b.label, undefined, { numeric: true });

/**
 * @param {{id:number, label:string, initial:boolean, accepting:boolean}[]} states
 * @param {{from:number, to:number, epsilon:boolean, symbols:string[]}[]} edges
 */
export function buildConversion(states, edges) {
  const ordered = [...states].sort(byLabel);
  const rank = new Map(ordered.map((s, i) => [s.id, i]));
  const labelOf = new Map(states.map((s) => [s.id, s.label]));
  const accepting = new Set(states.filter((s) => s.accepting).map((s) => s.id));
  const sortIds = (ids) => [...ids].sort((a, b) => rank.get(a) - rank.get(b));
  const setText = (ids) => sortIds(ids).map((id) => labelOf.get(id)).join(",");
  const marked = (state) => (state.initial ? INITIAL_MARK : "") + state.label + (state.accepting ? ACCEPTING_MARK : "");

  const epsilonNext = new Map(states.map((s) => [s.id, []]));
  const moves = new Map(states.map((s) => [s.id, new Map()])); // id -> symbol -> Set(id)
  const alphabet = new Set();
  for (const e of edges) {
    if (e.epsilon) epsilonNext.get(e.from)?.push(e.to);
    for (const symbol of e.symbols) {
      alphabet.add(symbol);
      const bySymbol = moves.get(e.from);
      if (!bySymbol.has(symbol)) bySymbol.set(symbol, new Set());
      bySymbol.get(symbol).add(e.to);
    }
  }
  const symbols = [...alphabet].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  // ε-closure of a set of states: iterative DFS over ε edges.
  const closureOf = (seed) => {
    const seen = new Set(seed);
    const stack = [...seed];
    while (stack.length) {
      for (const next of epsilonNext.get(stack.pop()) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    return seen;
  };
  const without = (set, removed) => [...set].filter((id) => !removed.has(id));
  const unionText = (core, closure) => `{${setText(core)}}U{${setText(without(closure, new Set(core)))}}`;

  // Step 1 and step 2.
  const closures = { headers: ["Estados", "Clausuras ε"], rows: [] };
  const nfaTable = { headers: ["Estados", "E", ...symbols], rows: [] };
  for (const state of ordered) {
    const closure = closureOf([state.id]);
    closures.rows.push([marked(state), unionText([state.id], closure)]);
    nfaTable.rows.push([
      marked(state),
      setText(without(closure, new Set([state.id]))),
      ...symbols.map((symbol) => setText(moves.get(state.id).get(symbol) ?? [])),
    ]);
  }

  // Step 3: subset construction, breadth-first from the initial closure.
  const dfaTable = { headers: ["Estados", ...symbols], rows: [] };
  const initialState = states.find((s) => s.initial);
  if (!initialState) return { closures, nfaTable, dfaTable, dfa: null };

  const dfa = { states: [], initial: "q0", accepting: [], transitions: [] };
  const nameOfSet = new Map(); // sorted-closure key -> { name, cell }
  const queue = [];
  const discover = (core) => {
    const closure = closureOf(core);
    const key = sortIds(closure).join(",");
    let entry = nameOfSet.get(key);
    if (!entry) {
      const name = `q${nameOfSet.size}`;
      const isAccepting = [...closure].some((id) => accepting.has(id));
      entry = { name, closure, isAccepting, label: `${unionText(core, closure)} = ${name}${isAccepting ? ACCEPTING_MARK : ""}` };
      nameOfSet.set(key, entry);
      queue.push(entry);
      dfa.states.push(name);
      if (isAccepting) dfa.accepting.push(name);
    }
    return { entry, cell: `${unionText(core, closure)} = ${entry.name}${entry.isAccepting ? ACCEPTING_MARK : ""}` };
  };

  discover([initialState.id]);
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    const row = [(i === 0 ? INITIAL_MARK : "") + current.label];
    for (const symbol of symbols) {
      const moved = new Set();
      for (const id of current.closure) for (const to of moves.get(id).get(symbol) ?? []) moved.add(to);
      if (!moved.size) {
        row.push("");
        continue;
      }
      const { entry, cell } = discover(sortIds(moved));
      row.push(cell);
      dfa.transitions.push({ from: current.name, symbol, to: entry.name });
    }
    dfaTable.rows.push(row);
  }
  return { closures, nfaTable, dfaTable, dfa };
}
