// Command registry for the Mealy editor — same "single source of every
// user-facing action" shape and rules as `commands/registry.js` (design
// D6: the toolbar and context menu are PROJECTIONS of `mealyActions`, never
// define their own behavior), kept as a separate, smaller registry rather
// than folding into the FA one: `run(ctx)`'s `ctx` is a `MealyContext`, not
// a `ViewContext` — a Mealy action calling an FA-shaped hook (or vice
// versa) would be a real bug, not just noise, so keeping them in two
// distinct arrays makes that impossible by construction instead of relying
// on every action author to remember which fields exist on which context.
//
// Deliberately smaller than the FA registry: no view/testing/interop/
// convert groups yet (no pan/zoom actions bound to keys, no menu bar, no
// jff-style import/export UI — see docs/decisions.md for what's still
// pending for Mealy). `keybindingOf` itself has nothing FA-specific in its
// signature (it only normalizes a raw `KeyboardEvent`), so it's imported
// from the FA registry module instead of being duplicated here.

export { keybindingOf } from "./registry.js";

function hasStateSelected(ctx) {
  return ctx.selection?.kind === "state";
}

function hasSelection(ctx) {
  return ctx.selection != null;
}

export const mealyActions = [
  // --- Tools (same V/S/T/D keys as the FA registry, for muscle-memory
  // consistency between the two editors) ------------------------------
  {
    id: "tool.select",
    title: "Seleccionar",
    group: "tools",
    keybinding: "v",
    when: () => true,
    run: (ctx) => ctx.setTool("select"),
  },
  {
    id: "tool.createState",
    title: "Estado",
    group: "tools",
    keybinding: "s",
    when: () => true,
    run: (ctx) => ctx.setTool("create-state"),
  },
  {
    id: "tool.createTransition",
    title: "Transición",
    group: "tools",
    keybinding: "t",
    when: () => true,
    run: (ctx) => ctx.setTool("create-transition"),
  },
  {
    id: "tool.delete",
    title: "Borrar",
    group: "tools",
    keybinding: "d",
    when: () => true,
    run: (ctx) => ctx.setTool("delete"),
  },

  // --- State actions (context menu) ------------------------------------
  {
    id: "state.rename",
    title: "Renombrar estado",
    group: "state",
    keybinding: "f2",
    when: hasStateSelected,
    run: async (ctx) => {
      const label = ctx.promptLabel ? await ctx.promptLabel(ctx.selection.id) : null;
      if (label) await ctx.renameState(ctx.selection.id, label);
    },
  },
  {
    id: "state.markInitial",
    title: "Marcar como inicial",
    group: "state",
    keybinding: null,
    when: hasStateSelected,
    run: (ctx) => ctx.docStore.apply([{ op: "SetInitial", id: ctx.selection.id }]),
  },

  // --- Edit -------------------------------------------------------------
  {
    id: "edit.deleteSelection",
    title: "Eliminar selección",
    group: "edit",
    keybinding: "delete",
    when: hasSelection,
    run: (ctx) => {
      const sel = ctx.selection;
      if (!sel) return;
      if (sel.kind === "state") {
        ctx.docStore.apply([{ op: "RemoveState", id: sel.id }]);
      } else if (sel.kind === "edge") {
        ctx.docStore.apply([{ op: "SetTransitions", from: sel.from, to: sel.to, entries: [] }]);
      }
    },
  },
  {
    id: "edit.undo",
    title: "Deshacer",
    group: "edit",
    keybinding: "ctrl+z",
    when: () => true,
    run: (ctx) => ctx.docStore.undo(),
  },
  {
    id: "edit.redo",
    title: "Rehacer",
    group: "edit",
    keybinding: "ctrl+shift+z",
    when: () => true,
    run: (ctx) => ctx.docStore.redo(),
  },
];

/** The 4 core tools, in registry order — mirrors `registry.js`'s `TOOL_IDS`. */
export const MEALY_TOOL_IDS = mealyActions.filter((a) => a.group === "tools").map((a) => a.id);

const byId = new Map(mealyActions.map((a) => [a.id, a]));

/** @param {string} id @returns {object|undefined} */
export function findMealyAction(id) {
  return byId.get(id);
}

/** @param {string} key normalized keybinding, e.g. "v", "ctrl+z" */
export function findMealyActionByKeybinding(key) {
  return mealyActions.find((a) => a.keybinding === key);
}
