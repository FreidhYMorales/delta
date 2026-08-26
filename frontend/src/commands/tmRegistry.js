// Command registry for the TM editor — same "single source of every
// user-facing action" shape and rules as `pdaRegistry.js` (design D6), kept
// as a separate, smaller registry rather than folding into it: `run(ctx)`'s
// `ctx` is a `TmContext`, not a `PdaContext`/`MooreContext`/`MealyContext`/
// `ViewContext` — keeping them in distinct arrays makes a wrong-context bug
// impossible by construction. `keybindingOf` is imported from the FA
// registry module, same as `pdaRegistry.js`'s.
//
// Two actions with no Moore/Mealy equivalent, same as PDA's:
//  - `state.toggleAccepting` — a direct boolean flip, no prompt needed.
//  - `transition.edit` — TM transitions are individually addressable (a
//    `TransitionId`, not a `(from,to)` edge), same reasoning as PDA's.
//
// Genuinely new vs. PDA: the transition create/edit flow prompts once PER
// TAPE (`promptTransitionTapes`, looping `ctx.promptTape`), not a fixed
// three times — tape count varies 1 to 5 (`tmLogic.js`'s
// `effectiveTapeCount`), unlike PDA's fixed `(input, pop, push)` triple.

export { keybindingOf } from "./registry.js";

import { effectiveTapeCount, formatTapeOpForPrompt, parseTapeOpText } from "../views/tmDiagram/tmLogic.js";

function hasStateSelected(ctx) {
  return ctx.selection?.kind === "state";
}

function hasTransitionSelected(ctx) {
  return ctx.selection?.kind === "transition";
}

function hasSelection(ctx) {
  return ctx.selection != null;
}

/**
 * Run the "one prompt per tape" flow — the one place owning "cancel at any
 * step aborts the whole op, no partial transition is ever created" (same "no
 * partial state" discipline as `pdaRegistry.js`'s `promptTransitionTriple`).
 * Shared by `tool.createTransition`'s click handler
 * (`TmDiagramView._handleCreateTransitionClick`) and this registry's own
 * `transition.edit` action.
 * @param {import('./TmContext.js').TmContext} ctx
 * @param {{read:string,write:string,direction:string}[]} [existingTapes]
 * @returns {Promise<{tapes: {read:string,write:string,direction:string}[]}|null>} `null` if cancelled at any step.
 */
export async function promptTransitionTapes(ctx, existingTapes = []) {
  const count = effectiveTapeCount(ctx.docStore, ctx);
  const tapes = [];
  for (let i = 0; i < count; i++) {
    const existingText = existingTapes[i] ? formatTapeOpForPrompt(existingTapes[i]) : "";
    const text = await ctx.promptTape(i, existingText);
    if (text == null) return null;
    tapes.push(parseTapeOpText(text));
  }
  return { tapes };
}

export const tmActions = [
  // --- Tools (same V/S/T/D keys as every other editor's registry) --------
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
    id: "state.toggleAccepting",
    title: "Alternar aceptación",
    group: "state",
    keybinding: null,
    when: hasStateSelected,
    run: (ctx) => {
      const state = ctx.docStore.getState(ctx.selection.id);
      if (!state) return;
      return ctx.docStore.apply([{ op: "SetAccepting", id: ctx.selection.id, accepting: !state.accepting }]);
    },
  },

  // --- Transition actions (double-click / context menu) ------------------
  {
    id: "transition.edit",
    title: "Editar transición",
    group: "transition",
    keybinding: null,
    when: hasTransitionSelected,
    run: async (ctx) => {
      const t = ctx.docStore.getTransition(ctx.selection.id);
      if (!t) return;
      const result = await promptTransitionTapes(ctx, t.tapes);
      if (!result) return;
      await ctx.docStore.apply([{ op: "EditTransition", id: t.id, ...result }]);
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
      } else if (sel.kind === "transition") {
        ctx.docStore.apply([{ op: "RemoveTransition", id: sel.id }]);
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

/** The 4 core tools, in registry order — mirrors `pdaRegistry.js`'s own `PDA_TOOL_IDS`. */
export const TM_TOOL_IDS = tmActions.filter((a) => a.group === "tools").map((a) => a.id);

/** Registry `group` -> menu title — mirrors `pdaRegistry.js`'s own
 * `PDA_MENU_GROUP_TITLES` (same PR11 rationale: only `edit` is menu-worthy
 * today). */
export const TM_MENU_GROUP_TITLES = {
  edit: "Editar",
};

const byId = new Map(tmActions.map((a) => [a.id, a]));

/** @param {string} id @returns {object|undefined} */
export function findTmAction(id) {
  return byId.get(id);
}

/** @param {string} key normalized keybinding, e.g. "v", "ctrl+z" */
export function findTmActionByKeybinding(key) {
  return tmActions.find((a) => a.keybinding === key);
}
