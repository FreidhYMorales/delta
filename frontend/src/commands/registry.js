// Single source of every user-facing action in the app (design D6). The
// menubar, context menus, toolbar and the command palette are all
// PROJECTIONS of `actions` — none of them may define an action of their
// own. That is what turns "every kflap-v0.1 action stays reachable even
// under progressive disclosure" (spec `diagram-editor` > "Progressive
// Disclosure With Full Reachability") from a review-time convention into a
// structural guarantee: a UI surface can only render actions it reads out
// of this array, so nothing can exist as a toolbar-only tool (task 7.2).
//
// Shape (design D6): `{ id, title, group, keybinding, when(ctx), run(ctx) }`.
// `keybinding` is a normalized string (lowercase letters, or `ctrl+<key>`)
// or `null` for actions that are menu/palette-reachable only — matching
// design D6's L3 disclosure rule ("interop/advanced, menu+palette only").
//
// `ctx` (constructed by the app shell in `main.js`, passed to every `run`)
// exposes: `activeTool`, `setTool(tool)`, `selection`, `setSelection(sel)`,
// `docStore` (a `DocStore` instance), `viewport` ({zoomIn,zoomOut,reset,
// fitToWindow}), `layout.circle()`, and `promptPath(kind)` /
// `importJff(path)` / `exportJff(path)` for the two jff.* actions (real
// native-dialog wiring for `promptPath` is deferred to PR6's L3 interop
// menu — task 7.7 — since no dialog plugin dependency exists yet; here it
// is an injectable hook so the action itself is fully testable today).

function hasStateSelected(ctx) {
  return ctx.selection?.kind === "state";
}

function hasSelection(ctx) {
  return ctx.selection != null;
}

export const actions = [
  // --- Tools (L0, kflap-v0.1 keys V/S/T/D) ---------------------------------
  {
    id: "tool.select",
    title: "Select / Move",
    group: "tools",
    keybinding: "v",
    when: () => true,
    run: (ctx) => ctx.setTool("select"),
  },
  {
    id: "tool.createState",
    title: "Create State",
    group: "tools",
    keybinding: "s",
    when: () => true,
    run: (ctx) => ctx.setTool("create-state"),
  },
  {
    id: "tool.createTransition",
    title: "Create Transition",
    group: "tools",
    keybinding: "t",
    when: () => true,
    run: (ctx) => ctx.setTool("create-transition"),
  },
  {
    id: "tool.delete",
    title: "Delete (click)",
    group: "tools",
    keybinding: "d",
    when: () => true,
    run: (ctx) => ctx.setTool("delete"),
  },

  // --- State actions (context menu: set-initial, toggle-accepting, rename,
  //     delete — spec `diagram-editor` > "Context Menu Actions") ------------
  {
    id: "state.rename",
    title: "Rename State",
    group: "state",
    keybinding: "f2",
    when: hasStateSelected,
    run: async (ctx) => {
      const label = ctx.promptLabel ? await ctx.promptLabel(ctx.selection.id) : null;
      // `ctx.renameState` (not a raw `docStore.apply`) so a name collision
      // surfaces a visible notice instead of silently doing nothing — see
      // `commands/renameState.js` / task 7.9.
      if (label) await ctx.renameState(ctx.selection.id, label);
    },
  },
  {
    id: "state.markInitial",
    title: "Mark as Initial",
    group: "state",
    keybinding: null,
    when: hasStateSelected,
    run: (ctx) => ctx.docStore.apply([{ op: "SetInitial", id: ctx.selection.id }]),
  },
  {
    id: "state.toggleAccepting",
    title: "Toggle Accepting",
    group: "state",
    keybinding: null,
    when: hasStateSelected,
    run: (ctx) => {
      const state = ctx.docStore.getState ? ctx.docStore.getState(ctx.selection.id) : undefined;
      const accepting = !(state?.accepting ?? false);
      ctx.docStore.apply([{ op: "SetAccepting", id: ctx.selection.id, accepting }]);
    },
  },

  // --- Edit -----------------------------------------------------------------
  {
    id: "edit.deleteSelection",
    title: "Delete Selection",
    group: "edit",
    keybinding: "delete",
    when: hasSelection,
    run: (ctx) => {
      const sel = ctx.selection;
      if (!sel) return;
      if (sel.kind === "state") {
        ctx.docStore.apply([{ op: "RemoveState", id: sel.id }]);
      } else if (sel.kind === "edge") {
        ctx.docStore.apply([
          { op: "SetEdge", from: sel.from, to: sel.to, epsilon: false, symbols: [] },
        ]);
      }
    },
  },
  {
    id: "edit.undo",
    title: "Undo",
    group: "edit",
    keybinding: "ctrl+z",
    when: () => true,
    run: (ctx) => ctx.docStore.undo(),
  },
  {
    id: "edit.redo",
    title: "Redo",
    group: "edit",
    keybinding: "ctrl+shift+z",
    when: () => true,
    run: (ctx) => ctx.docStore.redo(),
  },

  // --- View / layout ----------------------------------------------------
  {
    id: "view.zoomIn",
    title: "Zoom In",
    group: "view",
    keybinding: "ctrl+=",
    when: () => true,
    run: (ctx) => ctx.viewport.zoomIn(),
  },
  {
    id: "view.zoomOut",
    title: "Zoom Out",
    group: "view",
    keybinding: "ctrl+-",
    when: () => true,
    run: (ctx) => ctx.viewport.zoomOut(),
  },
  {
    id: "view.zoomReset",
    title: "Reset Zoom",
    group: "view",
    keybinding: "ctrl+0",
    when: () => true,
    run: (ctx) => ctx.viewport.reset(),
  },
  {
    id: "view.fitToWindow",
    title: "Fit to Window",
    group: "view",
    keybinding: "ctrl+1",
    when: () => true,
    run: (ctx) => ctx.viewport.fitToWindow(),
  },
  {
    id: "view.circleLayout",
    title: "Circle Layout",
    group: "view",
    keybinding: "ctrl+l",
    when: () => true,
    run: (ctx) => ctx.layout.circle(),
  },

  // --- Testing (L2, testing drawer — design D6) -----------------------------
  // These actions only OPEN the drawer and focus the relevant input; running
  // a trace/batch is still a deliberate click inside `TestingView`, same as
  // every other data-mutating/IO action in this app. This is what satisfies
  // spec `diagram-editor` > "Progressive Disclosure With Full Reachability"
  // for the L2 drawer specifically: the drawer is collapsed by default, but
  // both of its capabilities have a registry entry that reveals it.
  {
    id: "test.singleTrace",
    title: "Test String…",
    group: "test",
    keybinding: null,
    when: () => true,
    run: (ctx) => ctx.testing.openSingle(),
  },
  {
    id: "test.batch",
    title: "Batch Test…",
    group: "test",
    keybinding: null,
    when: () => true,
    run: (ctx) => ctx.testing.openBatch(),
  },

  // --- Interop (L3, menu+palette only — design D6) -------------------------
  {
    id: "jff.import",
    title: "Import .jff…",
    group: "interop",
    keybinding: null,
    when: () => true,
    run: async (ctx) => {
      const path = await ctx.promptPath("open-jff");
      if (path) await ctx.importJff(path);
    },
  },
  {
    id: "jff.export",
    title: "Export .jff…",
    group: "interop",
    keybinding: null,
    when: () => true,
    run: async (ctx) => {
      const path = await ctx.promptPath("save-jff");
      if (path) await ctx.exportJff(path);
    },
  },
];

/** The 4 core L0 diagram tools, in registry order (design D6/task 7.4). */
export const TOOL_IDS = actions.filter((a) => a.group === "tools").map((a) => a.id);

const byId = new Map(actions.map((a) => [a.id, a]));

/** @param {string} id @returns {object|undefined} */
export function findAction(id) {
  return byId.get(id);
}

/**
 * @param {string} key normalized keybinding, e.g. "v", "ctrl+z"
 * @returns {object|undefined}
 */
export function findByKeybinding(key) {
  return actions.find((a) => a.keybinding === key);
}

/**
 * Normalize a native `KeyboardEvent` into the same string format used by
 * `action.keybinding`, so DOM key handling never needs a second, parallel
 * mapping of keys to actions (this is part of the "nothing bypasses the
 * registry" guarantee — see `views/diagram/DiagramView.js`).
 * @param {KeyboardEvent} event
 */
export function keybindingOf(event) {
  const key = event.key.toLowerCase();
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push("ctrl");
  // `event.shiftKey` alone (not `key.length`) decides whether "shift" is
  // part of the binding: for single-character keys the browser already
  // reports the shifted glyph in `event.key` (e.g. "Z" for Ctrl+Shift+Z),
  // so lower-casing it loses the only signal that Shift was held. Bug 4:
  // the previous `key.length > 1` guard skipped "shift" for exactly those
  // single-character keys, making "ctrl+shift+z" collide with "ctrl+z".
  if (event.shiftKey) parts.push("shift");
  parts.push(key);
  return parts.join("+");
}
