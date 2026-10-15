// Prebuilt Thompson-construction pieces for building an NFA by hand: the
// five fragments of the Thompson nomenclature (r, rs, r|s, r*, r+). The
// user inserts a piece and types the value of each of its transitions
// (r, and s where the piece has one); blank means ε.
//
// Pieces nest the way Thompson's construction does: in the nomenclature,
// `r` and `s` are themselves boxes (sub-automata) between an entry and an
// exit state. So inserting a piece while a transition u -> v is selected
// REPLACES that transition with the piece — u becomes the piece's entry, v
// its exit, and only the piece's inner states are new. Inserting r* into
// the upper branch of r|s builds (r*)|s, and so on to any depth. With no
// transition selected, the piece is added on its own, to the right of
// whatever is already on the canvas.

import { nextStateLabel } from "../views/diagram/geometry.js";

const COLUMN = 160; // same spacing "Organizar" uses (layeredLayout)
const ROW = 90;

/**
 * `states`: grid offsets (columns, rows) from the piece's entry state.
 * `edges`: `slot` names the value the user types ("r"/"s"); no slot = ε.
 * `entry`/`exit`: indices into `states`.
 */
export const THOMPSON_PIECES = [
  {
    kind: "symbol",
    notation: "r",
    title: "Pieza r (transición)",
    slots: ["r"],
    states: [[0, 0], [1, 0]],
    edges: [{ from: 0, to: 1, slot: "r" }],
    entry: 0,
    exit: 1,
  },
  {
    kind: "concat",
    notation: "rs",
    title: "Pieza rs (concatenación)",
    slots: ["r", "s"],
    states: [[0, 0], [1, 0], [2, 0]],
    edges: [
      { from: 0, to: 1, slot: "r" },
      { from: 1, to: 2, slot: "s" },
    ],
    entry: 0,
    exit: 2,
  },
  {
    kind: "union",
    notation: "r|s",
    title: "Pieza r|s (unión)",
    slots: ["r", "s"],
    states: [[0, 0], [1, -1], [2, -1], [1, 1], [2, 1], [3, 0]],
    edges: [
      { from: 0, to: 1 },
      { from: 1, to: 2, slot: "r" },
      { from: 2, to: 5 },
      { from: 0, to: 3 },
      { from: 3, to: 4, slot: "s" },
      { from: 4, to: 5 },
    ],
    entry: 0,
    exit: 5,
  },
  {
    kind: "star",
    notation: "r*",
    title: "Pieza r* (cerradura de Kleene)",
    slots: ["r"],
    states: [[0, 1], [1, 0], [2, 0], [3, 1]],
    edges: [
      { from: 0, to: 1 },
      { from: 1, to: 2, slot: "r" },
      { from: 2, to: 1 },
      { from: 2, to: 3 },
      { from: 0, to: 3 },
    ],
    entry: 0,
    exit: 3,
  },
  {
    kind: "plus",
    notation: "r+",
    title: "Pieza r+ (cerradura positiva)",
    slots: ["r"],
    states: [[0, 0], [1, 0], [2, 0], [3, 0]],
    edges: [
      { from: 0, to: 1 },
      { from: 1, to: 2, slot: "r" },
      { from: 2, to: 1 },
      { from: 2, to: 3 },
    ],
    entry: 0,
    exit: 3,
  },
];

const PIECE_BY_KIND = new Map(THOMPSON_PIECES.map((p) => [p.kind, p]));

/**
 * Insert a Thompson piece — standalone, or replacing the selected
 * transition (see this file's header). Asks for every slot's value first
 * and changes nothing if any prompt is cancelled.
 * @param {import('./context.js').ViewContext} ctx
 * @param {string} kind one of THOMPSON_PIECES' `kind`
 * @returns {Promise<boolean>} false if cancelled
 */
export async function insertThompsonPiece(ctx, kind) {
  const piece = PIECE_BY_KIND.get(kind);
  if (!piece) throw new Error(`Pieza de Thompson desconocida: ${kind}`);
  const { docStore } = ctx;

  const host = ctx.selection?.kind === "edge" ? { from: ctx.selection.from, to: ctx.selection.to } : null;
  if (host && host.from === host.to) {
    throw new Error("No se puede insertar una pieza en un bucle: su entrada y su salida serían el mismo estado.");
  }

  const values = {};
  for (const slot of piece.slots) {
    const value = await ctx.promptSymbol(`Valor de ${slot} en ${piece.notation} (vacío = ε)`);
    if (value == null) return false;
    values[slot] = value;
  }

  // 1) Create the piece's states — all of them standalone, only the inner
  //    ones when nesting (entry/exit are the host transition's ends).
  const existing = docStore.getStates();
  const wasEmpty = existing.length === 0;
  const origin = standaloneOrigin(existing);
  const labels = [...existing];
  const newIndices = piece.states.map((_, i) => i).filter((i) => !host || (i !== piece.entry && i !== piece.exit));
  const addOps = newIndices.map((i) => {
    const label = nextStateLabel(labels);
    labels.push({ label });
    const [dx, dy] = piece.states[i];
    const anchor = host ? docStore.getState(host.from) : origin;
    return { op: "AddState", label, x: anchor.x + dx * COLUMN, y: anchor.y + dy * ROW };
  });
  const result = await docStore.apply(addOps);
  const addedIds = result.patches.filter((p) => p.patch === "StateAdded").map((p) => p.id);
  const idOf = new Map(newIndices.map((i, k) => [i, addedIds[k]]));
  if (host) {
    idOf.set(piece.entry, host.from);
    idOf.set(piece.exit, host.to);
  }

  // 2) Wire the piece's transitions (dropping the host transition it
  //    replaces), merging into any transition already on the same pair.
  const edgeOps = host ? [{ op: "SetEdge", from: host.from, to: host.to, epsilon: false, symbols: [] }] : [];
  for (const edge of piece.edges) {
    const from = idOf.get(edge.from);
    const to = idOf.get(edge.to);
    const value = edge.slot ? values[edge.slot] : "";
    const replaced = host && from === host.from && to === host.to;
    const current = replaced ? null : docStore.getEdge(from, to);
    const epsilon = value === "" || (current?.epsilon ?? false);
    const symbols = [...new Set([...(current?.symbols ?? []), ...(value === "" ? [] : [value])])];
    edgeOps.push({ op: "SetEdge", from, to, epsilon, symbols });
  }
  if (wasEmpty) {
    edgeOps.push({ op: "SetInitial", id: idOf.get(piece.entry) });
    edgeOps.push({ op: "SetAccepting", id: idOf.get(piece.exit), accepting: true });
  }
  await docStore.apply(edgeOps);

  // Nested pieces add states between two existing ones; let "Organizar"
  // make room for them instead of guessing where they fit.
  if (host) {
    ctx.setSelection(null);
    await ctx.layout.arrange();
  }
  return true;
}

/** Where a standalone piece's entry goes: one column right of the
 * rightmost state (on its row, so pieces chain left to right), or a fixed
 * spot on an empty canvas. */
function standaloneOrigin(states) {
  if (!states.length) return { x: 100, y: 200 };
  const rightmost = states.reduce((a, b) => (b.x > a.x ? b : a));
  return { x: rightmost.x + COLUMN, y: rightmost.y };
}
