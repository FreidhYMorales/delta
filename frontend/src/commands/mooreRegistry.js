// Command registry for the Moore editor — same "single source of every
// user-facing action" shape and rules as `mealyRegistry.js`/`registry.js`
// (design D6), kept as a separate, smaller registry rather than folding
// into either: `run(ctx)`'s `ctx` is a `MooreContext`, not a `MealyContext`
// or `ViewContext` — keeping them in distinct arrays makes a wrong-context
// bug impossible by construction. `keybindingOf` has nothing Mealy/FA-
// specific in its signature, so it's imported from the FA registry module
// instead of being duplicated a third time.
//
// One action with no Mealy equivalent: `state.setOutput` — Moore output
// lives on the state, not the edge, so there's no `promptTransition`-style
// action here; `tool.createTransition` only needs an input symbol
// (`ctx.promptInput`), and output is set separately via this action.

export { keybindingOf } from "./registry.js";

function hasStateSelected(ctx) {
  return ctx.selection?.kind === "state";
}

function hasSelection(ctx) {
  return ctx.selection != null;
}

export const mooreActions = [
  // --- Tools (same V/S/T/D keys as the FA/Mealy registries, for muscle-
  // memory consistency across the three editors) ------------------------
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
  {
    id: "state.setOutput",
    title: "Fijar salida",
    group: "state",
    keybinding: null,
    when: hasStateSelected,
    run: async (ctx) => {
      const output = ctx.promptOutput ? await ctx.promptOutput(ctx.selection.id) : null;
      if (output != null) {
        await ctx.docStore.apply([{ op: "SetOutput", state: ctx.selection.id, output }]);
      }
    },
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
        ctx.docStore.apply([{ op: "SetTransitions", from: sel.from, to: sel.to, inputs: [] }]);
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

/** The 4 core tools, in registry order — mirrors `mealyRegistry.js`'s `MEALY_TOOL_IDS`. */
export const MOORE_TOOL_IDS = mooreActions.filter((a) => a.group === "tools").map((a) => a.id);

/** Registry `group` -> menu title — mirrors `mealyRegistry.js`'s own
 * `MEALY_MENU_GROUP_TITLES` (same PR11 rationale: only `edit` is menu-worthy
 * today). */
export const MOORE_MENU_GROUP_TITLES = {
  edit: "Editar",
};

const byId = new Map(mooreActions.map((a) => [a.id, a]));

/** @param {string} id @returns {object|undefined} */
export function findMooreAction(id) {
  return byId.get(id);
}

/** @param {string} key normalized keybinding, e.g. "v", "ctrl+z" */
export function findMooreActionByKeybinding(key) {
  return mooreActions.find((a) => a.keybinding === key);
}
