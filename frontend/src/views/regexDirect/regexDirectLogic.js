// Pure (DOM-free) presentation of the direct method's result
// (`conv_regex_to_dfa_direct`, `automata_core::convert::DirectDfa`): the
// worksheet's tables (`idea/nuevos_agregados/ER a AFD.pdf`) and the syntax
// tree's layout. All the algorithmic work happens in the core; this only
// formats it.

const INITIAL_MARK = "→ ";
const ACCEPTING_MARK = "*";
const yesNo = (value) => (value ? "Verdadero" : "Falso");
const setText = (positions) => `{${positions.join(",")}}`;

/**
 * @param {object} result `DirectDfa` as returned by the core
 * @returns {{leaves, nodes, followpos, states, transitions, dfa}} each table
 *   is `{headers: string[], rows: string[][]}`; `dfa` is
 *   `applyAutomatonModel`'s label-addressed model
 */
export function buildDirectTables(result) {
  const { nodes, root, positions, alphabet, states, transitions } = result;
  const expression = subexpressions(nodes, root);

  const leaves = {
    headers: ["i", "Símbolo", "Anulable"],
    rows: positions.map((p) => [String(p.position), p.symbol, yesNo(false)]),
  };

  const nodeTable = {
    headers: ["Nodo", "Anulable", "PrimeraPos", "ÚltimaPos"],
    rows: nodes.map((node, i) => [
      node.position != null ? `${node.label} (${node.position})` : expression[i],
      yesNo(node.nullable),
      setText(node.firstpos),
      setText(node.lastpos),
    ]),
  };

  const followpos = {
    headers: ["i", "Símbolo", "SiguientePos"],
    rows: positions.map((p) => [String(p.position), p.symbol, setText(p.followpos)]),
  };

  const marked = (state) => (state.initial ? INITIAL_MARK : "") + state.name + (state.accepting ? ACCEPTING_MARK : "");
  const stateTable = {
    headers: ["Conjunto", "Estado"],
    rows: states.map((s) => [setText(s.positions), marked(s)]),
  };

  const target = new Map(transitions.map((t) => [`${t.from}\u0000${t.symbol}`, t.to]));
  const transitionTable = {
    headers: ["Estado", ...alphabet],
    rows: states.map((s) => [marked(s), ...alphabet.map((a) => target.get(`${s.name}\u0000${a}`) ?? "")]),
  };

  const dfa = {
    states: states.map((s) => s.name),
    initial: states.find((s) => s.initial)?.name ?? null,
    accepting: states.filter((s) => s.accepting).map((s) => s.name),
    transitions: transitions.map(({ from, symbol, to }) => ({ from, symbol, to })),
  };

  return { leaves, nodes: nodeTable, followpos, states: stateTable, transitions: transitionTable, dfa };
}

/** Each node's subexpression as text, with only the parentheses its
 * operator needs; the augmented root reads `(r)#`, as in the worksheet. */
function subexpressions(nodes, root) {
  const text = [];
  const precedence = { union: 0, concat: 1, star: 2, plus: 2, optional: 2 };
  const prec = (i) => precedence[nodes[i].kind] ?? 3;
  const wrap = (i, required) => (prec(i) < required ? `(${text[i]})` : text[i]);
  nodes.forEach((node, i) => {
    const [a, b] = node.children;
    switch (node.kind) {
      case "union":
        text[i] = `${text[a]}|${text[b]}`;
        break;
      case "concat":
        text[i] = i === root ? `(${text[a]})${text[b]}` : `${wrap(a, 1)}${wrap(b, 1)}`;
        break;
      case "star":
      case "plus":
      case "optional":
        text[i] = `${wrap(a, 2)}${node.label}`;
        break;
      default:
        text[i] = node.label;
    }
  });
  return text;
}

/**
 * Tidy layout for the syntax tree: leaves left to right in order, each
 * parent centered over its children, one row per depth (root on top).
 * @param {{children:number[]}[]} nodes post-order (children before parent)
 * @param {number} root
 * @param {{leafSpacing?:number, levelSpacing?:number}} [opts]
 * @returns {{x:number, y:number}[]} indexed like `nodes`
 */
export function layoutSyntaxTree(nodes, root, { leafSpacing = 80, levelSpacing = 70 } = {}) {
  const at = new Array(nodes.length);
  let nextLeaf = 0;
  // Iterative depth-first walk (no recursion: a long concatenation is a
  // deep tree); children are visited before their parent is placed.
  const stack = [{ i: root, depth: 0, expanded: false }];
  while (stack.length) {
    const frame = stack.pop();
    const node = nodes[frame.i];
    if (!node.children.length) {
      at[frame.i] = { x: nextLeaf++ * leafSpacing, y: frame.depth * levelSpacing };
    } else if (!frame.expanded) {
      stack.push({ ...frame, expanded: true });
      for (let k = node.children.length - 1; k >= 0; k--) {
        stack.push({ i: node.children[k], depth: frame.depth + 1, expanded: false });
      }
    } else {
      const xs = node.children.map((c) => at[c].x);
      at[frame.i] = { x: xs.reduce((s, x) => s + x, 0) / xs.length, y: frame.depth * levelSpacing };
    }
  }
  return at;
}
