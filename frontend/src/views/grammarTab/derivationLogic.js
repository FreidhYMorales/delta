// Pure (DOM-free) helpers for the "Gramática" tab's string tests: laying
// out a derivation tree (`grammar_derive`'s `tree`) and the texts shown for
// a derivation. For type 1-3 grammars it is a plain tree; a type-0 rewrite
// of several symbols (e.g. `abA → baab`) joins them through one "rule"
// node, so the layout works on any rooted DAG.

const OUTCOME_LABELS = {
  accepted: "✓ Aceptada",
  rejected: "✗ Rechazada",
  limit_reached: "? No determinada (límite de búsqueda)",
};

/** @param {"accepted"|"rejected"|"limit_reached"} outcome */
export function outcomeLabel(outcome) {
  return OUTCOME_LABELS[outcome];
}

/** `S ⇒ aS ⇒ ab` */
export function derivationText({ forms }) {
  return forms.join(" ⇒ ");
}

/** One string per line, trimmed, blank lines skipped (`ε` stands for the
 * empty string, which the core understands as such). */
export function parseBatch(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Positions for every node: each node one level below its deepest parent,
 * leaves left to right in the order the derivation reaches them, every
 * parent centered over its children.
 * @param {{nodes: {children:number[]}[], root:number}} tree
 * @param {{leafSpacing?:number, levelSpacing?:number}} [opts]
 * @returns {{x:number, y:number}[]}
 */
export function layoutDerivationTree({ nodes, root }, { leafSpacing = 44, levelSpacing = 56 } = {}) {
  // Iterative DFS from the root: preorder gives the leaf order, postorder
  // gives children-before-parents (a shared child finishes before its
  // first parent, so before all of them).
  const preorder = [];
  const postorder = [];
  const visited = new Set([root]);
  const stack = [{ id: root, next: 0 }];
  preorder.push(root);
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const children = nodes[frame.id].children;
    if (frame.next < children.length) {
      const child = children[frame.next++];
      if (!visited.has(child)) {
        visited.add(child);
        preorder.push(child);
        stack.push({ id: child, next: 0 });
      }
    } else {
      postorder.push(frame.id);
      stack.pop();
    }
  }

  const level = new Map([[root, 0]]);
  for (const id of [...postorder].reverse()) {
    for (const child of nodes[id].children) {
      level.set(child, Math.max(level.get(child) ?? 0, level.get(id) + 1));
    }
  }

  // A type-0 rule junction has several parents (the rewritten symbols):
  // they sit side by side above it rather than all on top of each other.
  const parentsOf = new Map();
  for (const id of preorder) {
    for (const child of nodes[id].children) {
      if (!parentsOf.has(child)) parentsOf.set(child, []);
      if (!parentsOf.get(child).includes(id)) parentsOf.get(child).push(id);
    }
  }

  const at = new Array(nodes.length);
  let nextLeaf = 0;
  for (const id of preorder) {
    if (!nodes[id].children.length) at[id] = { x: nextLeaf++ * leafSpacing, y: 0 };
  }
  for (const id of postorder) {
    const children = nodes[id].children;
    const shared = children.length === 1 ? parentsOf.get(children[0]) : null;
    if (shared && shared.length > 1) {
      const offset = shared.indexOf(id) - (shared.length - 1) / 2;
      at[id] = { x: at[children[0]].x + offset * leafSpacing, y: 0 };
    } else if (children.length) {
      at[id] = { x: children.reduce((sum, c) => sum + at[c].x, 0) / children.length, y: 0 };
    }
    at[id].y = level.get(id) * levelSpacing;
  }
  return at;
}
