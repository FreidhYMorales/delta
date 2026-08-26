// Registry of every "Archivo" (File) action — a NEW, SEPARATE registry from
// FA's `actions` (`./registry.js`), not folded into it (design D8): these
// actions must keep working even when there is no FA tab open/focused, so
// none of them may read an FA-specific `ctx` field. Same
// `{id, title, group, keybinding, when, run}` shape as `registry.js`'s own
// actions (PR10 wires both into `MenuBar` with minimal glue).
//
// "Recientes" is the ONE deliberate exception to "menus are pure
// projections over a static action list" (design D8): a list of recently
// opened file paths is inherently dynamic, so instead of `run` it carries a
// `submenu: { items(ctx) }` returning a dynamic list of sub-actions.
//
// Error handling (follow-up fix): every action here that touches disk or
// the backend (Abrir/Guardar/Guardar como/Recientes, Nueva/Renombrar
// pestaña) now wraps the call in try/catch + `showNotice` on failure —
// before this, a rejected promise here (a Recientes entry pointing at a
// since-deleted file; a "Nueva pestaña"/rename colliding with a name
// already used) surfaced nowhere: `MenuBar.js`'s own item click handler
// never awaits or catches `action.run(ctx)`, so it just became an
// unhandled rejection, and the click looked like it silently did nothing.
// Every FA/Mealy/Moore/Pda/Tm-specific action already followed this same
// try/catch + `showNotice` convention (e.g. `mountFaTab.js`'s
// `importJff`/`exportJff`) — this only extends it to the project-level
// actions, which had never gotten it.

import { showNotice } from "../ui/notice.js";

/** Registry `group` -> menu title (mirrors `MenuBar.js`'s own
 * `MENU_GROUP_TITLES`, same "single source of truth for the reachability
 * audit" rationale — `commands/reachabilityAudit.test.js`). Both `file` and
 * `tabs` collide into the SAME "Archivo" title as Fa's own `interop` group
 * (design D9): under the multi-source `MenuBar` contract this is exactly
 * what lets the "Archivo" menu be composed of several independent
 * sections — project file ops, tab ops, and (when an FA tab is active)
 * jff import/export — under one shared top-level title, not a fresh group
 * of its own. */
export const PROJECT_MENU_GROUP_TITLES = {
  file: "Archivo",
  tabs: "Archivo",
};

const alwaysOn = () => true;

/** Saves to the project's already-known `filePath`, or prompts for one if
 * it has never been saved — the exact same "Guardar" logic `project.save`'s
 * own `run` uses below, factored out so `confirmDiscardIfDirty`'s "save"
 * branch doesn't duplicate it.
 * @returns {Promise<boolean>} true once the save actually completed; false
 * if the user cancelled the path prompt (never-yet-saved project). */
async function saveToKnownOrPromptedPath(ctx) {
  let path = ctx.projectStore.filePath;
  if (!path) {
    path = await ctx.promptPath("save-project");
    if (!path) return false;
  }
  try {
    await ctx.projectStore.save(path);
  } catch (error) {
    showNotice({ kind: "error", title: "No se pudo guardar el proyecto", message: String(error?.message ?? error) });
    return false;
  }
  ctx.recentProjects?.add(path);
  return true;
}

/** Guards `project.new`/`project.open` — both REPLACE the whole project,
 * discarding any unsaved work in it. When the current project has no
 * unsaved changes, this is a silent no-op (no dialog). Otherwise it asks
 * via `ctx.confirmDiscard()` (wired to `ui/choiceModal.js` — Save/Discard/
 * Cancel) and only lets the replacing action proceed once that's resolved
 * one way or the other; if the user picks "save" but then cancels the
 * save-path prompt (a never-yet-saved project), this still refuses to
 * proceed rather than silently discarding after all.
 * @returns {Promise<boolean>} true when the caller should proceed. */
export async function confirmDiscardIfDirty(ctx) {
  if (!ctx.projectStore.isDirty) return true;
  const choice = await ctx.confirmDiscard();
  if (choice === "cancel") return false;
  if (choice === "discard") return true;
  return saveToKnownOrPromptedPath(ctx);
}

/** Same guard as `confirmDiscardIfDirty`, but scoped to ONE tab
 * (`ProjectStore.isTabDirty`) instead of the whole project's aggregate —
 * closing a single tab only discards that tab's own unsaved work, not
 * every open tab's, so it shouldn't ask (or block) over changes elsewhere
 * in the project. "Save" still saves the WHOLE project (there's no
 * per-tab save on disk, a project is always one file) via the same
 * known-path-or-prompt logic `project.save` uses.
 * @param {import('./ProjectContext.js').ProjectContext} ctx
 * @param {number} tabId
 * @returns {Promise<boolean>} true when the caller should proceed and
 * actually close the tab. */
export async function confirmDiscardTabIfDirty(ctx, tabId) {
  if (!ctx.projectStore.isTabDirty(tabId)) return true;
  const choice = await ctx.confirmDiscard();
  if (choice === "cancel") return false;
  if (choice === "discard") return true;
  return saveToKnownOrPromptedPath(ctx);
}

export const projectActions = [
  {
    id: "project.new",
    title: "Nuevo proyecto",
    group: "file",
    keybinding: null,
    when: alwaysOn,
    run: async (ctx) => {
      if (!(await confirmDiscardIfDirty(ctx))) return;
      await ctx.projectStore.newProject();
    },
  },

  // A single "Nueva pestaña" entry (design D8 rework) — `promptNewTab`
  // opens a modal to pick BOTH the kind and the name at once, replacing the
  // old one-menu-entry-per-`MACHINE_KINDS` design ("Nuevo: Autómata Finito",
  // "Nuevo: Mealy", ...), which didn't scale well in the Archivo menu and
  // had no keybinding of its own (5 competing entries can't share one).
  {
    id: "project.newTab",
    title: "Nueva pestaña",
    group: "tabs",
    keybinding: "ctrl+n",
    when: alwaysOn,
    run: async (ctx) => {
      const result = await ctx.promptNewTab();
      if (!result) return;
      try {
        await ctx.projectStore.newTab(result.kind, result.name);
      } catch (error) {
        showNotice({ kind: "error", title: "No se pudo crear la pestaña", message: String(error?.message ?? error) });
      }
    },
  },

  {
    id: "project.closeTab",
    title: "Cerrar pestaña",
    group: "tabs",
    keybinding: "ctrl+w",
    when: (ctx) => ctx.projectStore.tabs.length > 0,
    run: async (ctx) => {
      const tabId = ctx.projectStore.activeTabId;
      if (tabId == null) return;
      if (!(await confirmDiscardTabIfDirty(ctx, tabId))) return;
      return ctx.projectStore.closeTab(tabId);
    },
  },
  {
    id: "project.renameTab",
    title: "Renombrar pestaña",
    group: "tabs",
    keybinding: null,
    when: (ctx) => ctx.projectStore.activeTabId != null,
    run: async (ctx) => {
      const tabId = ctx.projectStore.activeTabId;
      if (tabId == null) return;
      const name = await ctx.promptTabName();
      if (!name) return;
      try {
        await ctx.projectStore.renameTab(tabId, name);
      } catch (error) {
        showNotice({ kind: "error", title: "No se pudo renombrar la pestaña", message: String(error?.message ?? error) });
      }
    },
  },

  {
    id: "project.open",
    title: "Abrir proyecto…",
    group: "file",
    keybinding: "ctrl+o",
    when: alwaysOn,
    run: async (ctx) => {
      if (!(await confirmDiscardIfDirty(ctx))) return;
      const path = await ctx.promptPath("open-project");
      if (!path) return;
      try {
        await ctx.projectStore.open(path);
      } catch (error) {
        showNotice({ kind: "error", title: "No se pudo abrir el proyecto", message: String(error?.message ?? error) });
        return;
      }
      ctx.recentProjects?.add(path);
    },
  },
  // "Guardar" reuses the path the project was last opened from/saved to
  // (`ProjectStore.filePath`) and silently overwrites it — only a
  // never-yet-saved project (`filePath === null`) prompts, same as any
  // desktop app's first save. "Guardar como…" always prompts, regardless
  // of `filePath`, to save a separate copy under a different name/path.
  {
    id: "project.save",
    title: "Guardar",
    group: "file",
    keybinding: "ctrl+s",
    when: alwaysOn,
    run: (ctx) => saveToKnownOrPromptedPath(ctx),
  },
  {
    id: "project.saveAs",
    title: "Guardar como…",
    group: "file",
    keybinding: "ctrl+shift+s",
    when: alwaysOn,
    run: async (ctx) => {
      const path = await ctx.promptPath("save-project");
      if (!path) return;
      try {
        await ctx.projectStore.save(path);
      } catch (error) {
        showNotice({ kind: "error", title: "No se pudo guardar el proyecto", message: String(error?.message ?? error) });
        return;
      }
      ctx.recentProjects?.add(path);
    },
  },

  {
    id: "project.recent",
    title: "Recientes",
    group: "file",
    keybinding: null,
    when: alwaysOn,
    // The dynamic exception (design D8): no `run`, a `submenu.items(ctx)`
    // instead — recomputed on every open, always reflecting
    // `ctx.recentProjects`'s CURRENT list, never a stale static array.
    submenu: {
      items: (ctx) =>
        (ctx.recentProjects?.list() ?? []).map((path) => ({
          id: `project.recent:${path}`,
          title: path,
          run: async (c) => {
            try {
              await c.projectStore.open(path);
            } catch (error) {
              showNotice({ kind: "error", title: "No se pudo abrir el proyecto", message: String(error?.message ?? error) });
              return;
            }
            c.recentProjects?.add(path);
          },
        })),
    },
  },
];

const byId = new Map(projectActions.map((a) => [a.id, a]));

/** @param {string} id @returns {object|undefined} */
export function findProjectAction(id) {
  return byId.get(id);
}
