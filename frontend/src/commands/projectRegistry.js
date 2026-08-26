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

import { MACHINE_KINDS } from "../project/machineKinds.js";

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

/** @param {(kind: string) => string} idOf */
function newTabActionFor(kind) {
  return {
    id: `project.newTab.${kind.id}`,
    title: `Nuevo: ${kind.label}`,
    group: "tabs",
    keybinding: null,
    when: alwaysOn,
    run: async (ctx) => {
      const name = await ctx.promptTabName(kind.id);
      if (name) await ctx.projectStore.newTab(kind.id, name);
    },
  };
}

export const projectActions = [
  {
    id: "project.new",
    title: "Nuevo proyecto",
    group: "file",
    keybinding: null,
    when: alwaysOn,
    run: (ctx) => ctx.projectStore.newProject(),
  },

  ...MACHINE_KINDS.map(newTabActionFor),

  {
    id: "project.closeTab",
    title: "Cerrar pestaña",
    group: "tabs",
    keybinding: "ctrl+w",
    when: (ctx) => ctx.projectStore.tabs.length > 0,
    run: (ctx) => {
      const tabId = ctx.projectStore.activeTabId;
      if (tabId != null) return ctx.projectStore.closeTab(tabId);
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
      if (name) await ctx.projectStore.renameTab(tabId, name);
    },
  },

  {
    id: "project.open",
    title: "Abrir proyecto…",
    group: "file",
    keybinding: "ctrl+o",
    when: alwaysOn,
    run: async (ctx) => {
      const path = await ctx.promptPath("open-project");
      if (!path) return;
      await ctx.projectStore.open(path);
      ctx.recentProjects?.add(path);
    },
  },
  {
    id: "project.save",
    title: "Guardar proyecto",
    group: "file",
    keybinding: "ctrl+s",
    when: alwaysOn,
    run: async (ctx) => {
      const path = await ctx.promptPath("save-project");
      if (!path) return;
      await ctx.projectStore.save(path);
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
            await c.projectStore.open(path);
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
