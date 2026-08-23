// Command registry for the PDA editor — same "single source of every
// user-facing action" shape and rules as `mooreRegistry.js`/`mealyRegistry.js`
// (design D6), kept as a separate, smaller registry rather than folding
// into either: `run(ctx)`'s `ctx` is a `PdaContext`, not a `MooreContext`/
// `MealyContext`/`ViewContext` — keeping them in distinct arrays makes a
// wrong-context bug impossible by construction. `keybindingOf` has nothing
// PDA-specific in its signature, so it's imported from the FA registry
// module instead of being duplicated a fourth time.
//
// Two actions with no Moore/Mealy equivalent:
//  - `state.toggleAccepting` — PDA has accepting states, Moore/Mealy don't.
//    A direct boolean flip, no prompt needed (unlike Moore's `state.setOutput`,
//    which needs a value).
//  - `transition.edit` — PDA transitions are individually addressable (a
//    `TransitionId`, not a `(from,to)` edge), so "delete the edge between
//    these two states" is ambiguous when several can share the same
//    endpoints; editing/deleting always targets one specific transition id.

export { keybindingOf } from "./registry.js";

import { formatSymbolListForPrompt, parseInputSymbol, parseSymbolList } from "../views/pdaDiagram/pdaLogic.js";

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
 * Run the "input, pop, push" three-prompt flow — the one place owning
 * "cancel at any step aborts the whole op, no partial transition is ever
 * created" (same "no partial state" discipline as the rest of this
 * codebase's prompt flows). Shared by `tool.createTransition`'s click
 * handler (`PdaDiagramView._handleCreateTransitionClick`) and this
 * registry's own `transition.edit` action, so the two-click-create and
 * edit-existing flows can never drift apart.
 * @param {import('./PdaContext.js').PdaContext} ctx
 * @param {{input?: string|null, pop?: string[], push?: string[]}} [existing]
 * @returns {Promise<{input: string|null, pop: string[], push: string[]}|null>} `null` if cancelled at any step.
 */
export async function promptTransitionTriple(ctx, existing = {}) {
  const inputText = await ctx.promptInput(existing.input ?? "");
  if (inputText == null) return null;
  const popText = await ctx.promptPop(formatSymbolListForPrompt(existing.pop ?? []));
  if (popText == null) return null;
  const pushText = await ctx.promptPush(formatSymbolListForPrompt(existing.push ?? []));
  if (pushText == null) return null;
  return { input: parseInputSymbol(inputText), pop: parseSymbolList(popText), push: parseSymbolList(pushText) };
}

export const pdaActions = [
  // --- Tools (same V/S/T/D keys as the FA/Mealy/Moore registries, for
  // muscle-memory consistency across every editor) -----------------------
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
      const result = await promptTransitionTriple(ctx, { input: t.input, pop: t.pop, push: t.push });
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

/** The 4 core tools, in registry order — mirrors `mooreRegistry.js`'s `MOORE_TOOL_IDS`. */
export const PDA_TOOL_IDS = pdaActions.filter((a) => a.group === "tools").map((a) => a.id);

const byId = new Map(pdaActions.map((a) => [a.id, a]));

/** @param {string} id @returns {object|undefined} */
export function findPdaAction(id) {
  return byId.get(id);
}

/** @param {string} key normalized keybinding, e.g. "v", "ctrl+z" */
export function findPdaActionByKeybinding(key) {
  return pdaActions.find((a) => a.keybinding === key);
}
