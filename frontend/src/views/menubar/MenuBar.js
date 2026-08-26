// Top-level app menu bar — the UI/UX audit's fix for actions that had ZERO
// visible trigger anywhere (`jff.import`, `jff.export`, `test.singleTrace`,
// `test.batch`) and for keyboard-only actions with no visible affordance
// (undo/redo/zoom/fit/auto layout). Every item is still only ever a
// PROJECTION of a registry action — clicking one only ever calls
// `action.run(ctx)`, same guarantee as before (design D6).
//
// Design D9 (PR10): MenuBar is now MULTI-SOURCE. It no longer imports
// `commands/registry.js`'s `actions` itself or owns a single shared `ctx` —
// the constructor now takes a `menus` array built by the CALLER:
//
//   menus: [{ title, sections: [{ id, actions, ctx }] }]
//
// Each SECTION carries its own `actions` array AND its own `ctx` to
// evaluate/run those actions against. This is what lets a project-level
// "Archivo" menu be composed out of several independent sources — Fa's own
// `interop` group (jff import/export, `ViewContext`) plus the project
// registry's `file`/`tabs` groups (`ProjectContext`) — without either
// source needing to know about the other's context shape, and what lets a
// non-FA tab's caller simply not include an FA-scoped section at all: a
// missing section is structurally ABSENT from the rendered menu, not a
// present-but-disabled item (the "hidden not disabled" rule).
//
// Multiple entries sharing the same `title` (e.g. Fa's `interop` group and
// the project registry's `file`/`tabs` groups all titling themselves
// "Archivo" — see `MENU_GROUP_TITLES`/`PROJECT_MENU_GROUP_TITLES`) are
// merged into ONE top-level trigger+dropdown, in first-seen order, so a
// caller never needs to pre-merge them itself.
//
// Deliberately excludes the `tools` and `state` groups: those already have
// a good visible trigger (the diagram toolbar and the state right-click
// context menu, respectively), so mirroring them here would only add
// clutter without improving discoverability — this project's UI priority is
// "modernize the look, simplify visible tools", not a dense classic-JFLAP
// menu that repeats every surface.

/** Registry `group` -> menu title, in the order the menu bar renders them
 * (Fa's own groups). Exported so the reachability-audit test
 * (`commands/reachabilityAudit.test.js`) has ONE source of truth for "which
 * groups the menu bar covers" instead of a second hardcoded copy that could
 * silently drift out of sync. No longer read internally by `MenuBar` itself
 * (composing `menus` is now the caller's job) — kept purely as that shared
 * reference table. */
export const MENU_GROUP_TITLES = {
  interop: "Archivo",
  edit: "Editar",
  view: "Ver",
  convert: "Convertir",
  test: "Test",
};

const KEY_LABELS = { ctrl: "Ctrl", shift: "Shift" };

/** Normalizes a registry `keybinding` string into a human-readable hint,
 * e.g. "ctrl+shift+z" -> "Ctrl+Shift+Z", "delete" -> "Delete", "f2" ->
 * "F2". Returns "" for `null`/`undefined` (menu/palette-only actions). */
export function formatKeybinding(keybinding) {
  if (!keybinding) return "";
  return keybinding
    .split("+")
    .map((part) => KEY_LABELS[part] ?? part.charAt(0).toUpperCase() + part.slice(1))
    .join("+");
}

export class MenuBar {
  /**
   * @param {HTMLElement} container
   * @param {{title: string, sections: {id: string, actions: object[], ctx: object}[]}[]} menus
   */
  constructor(container, menus) {
    this.container = container;
    this.menus = menus;
    /** Title of the currently open dropdown, or `null`. */
    this._openMenu = null;
    this._menus = new Map();

    this._buildDom();
    this._subscribeToSectionContexts();
    this._render();
  }

  /** Every section carries its own `ctx` — re-render whenever ANY of them
   * (deduplicated, since the same `ctx` instance is typically shared across
   * several sections/menus) notifies, same "one subscribe covers everything
   * a `when(ctx)` reads" contract as before, just fanned out per source. */
  _subscribeToSectionContexts() {
    const seen = new Set();
    for (const menu of this.menus) {
      for (const section of menu.sections) {
        if (seen.has(section.ctx)) continue;
        seen.add(section.ctx);
        if (typeof section.ctx?.subscribe === "function") {
          section.ctx.subscribe(() => this._render());
        }
      }
    }
  }

  _buildDom() {
    this.root = document.createElement("nav");
    this.root.className = "menu-bar";
    this.root.setAttribute("aria-label", "Application menu");

    const order = [];
    const sectionsByTitle = new Map();
    for (const menu of this.menus) {
      if (!sectionsByTitle.has(menu.title)) {
        sectionsByTitle.set(menu.title, []);
        order.push(menu.title);
      }
      sectionsByTitle.get(menu.title).push(...menu.sections);
    }

    for (const title of order) {
      const sections = sectionsByTitle.get(title);
      const totalActions = sections.reduce((n, s) => n + s.actions.length, 0);
      if (!totalActions) continue;

      const wrapper = document.createElement("div");
      wrapper.className = "menu-bar-menu";

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "menu-bar-item";
      trigger.textContent = title;
      trigger.addEventListener("click", () => this._toggleMenu(title));

      const dropdown = document.createElement("div");
      dropdown.className = "menu-dropdown";
      dropdown.hidden = true;

      const items = new Map();
      /** Flat `{action, ctx, item}` list for `_render`'s enable/disable pass —
       * spans every section merged under this title. */
      const entries = [];
      for (const section of sections) {
        for (const action of section.actions) {
          const { item, extra } = this._buildItem(action, section.ctx);
          dropdown.appendChild(item);
          if (extra) dropdown.appendChild(extra);
          items.set(action.id, item);
          entries.push({ action, ctx: section.ctx, item });
        }
      }

      wrapper.append(trigger, dropdown);
      this.root.appendChild(wrapper);
      this._menus.set(title, { wrapper, trigger, dropdown, items, entries });
    }

    this.container.appendChild(this.root);
  }

  /** Builds one dropdown item for `action`, evaluated/run against `ctx`.
   * Returns `{item, extra}` — `extra` is the nested submenu element for the
   * one dynamic-`submenu` exception (design D8's "Recientes"), or `null`. */
  _buildItem(action, ctx) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "menu-dropdown-item";
    item.dataset.action = action.id;

    const titleSpan = document.createElement("span");
    titleSpan.className = "menu-dropdown-item-title";
    titleSpan.textContent = action.title;
    item.appendChild(titleSpan);

    const hint = formatKeybinding(action.keybinding);
    if (hint) {
      const hintSpan = document.createElement("span");
      hintSpan.className = "menu-dropdown-item-hint";
      hintSpan.textContent = hint;
      item.appendChild(hintSpan);
    }

    if (action.submenu) {
      item.classList.add("menu-dropdown-item-submenu-trigger");
      const submenu = document.createElement("div");
      submenu.className = "menu-submenu";
      submenu.hidden = true;
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        submenu.innerHTML = "";
        const dynamicItems = action.submenu.items(ctx) ?? [];
        for (const dynamicItem of dynamicItems) {
          const subButton = document.createElement("button");
          subButton.type = "button";
          subButton.className = "menu-dropdown-item menu-submenu-item";
          subButton.dataset.action = dynamicItem.id;
          subButton.textContent = dynamicItem.title;
          subButton.addEventListener("click", (subEvent) => {
            subEvent.stopPropagation();
            dynamicItem.run(ctx);
            this._closeMenu();
          });
          submenu.appendChild(subButton);
        }
        submenu.hidden = !submenu.hidden;
      });
      return { item, extra: submenu };
    }

    item.addEventListener("click", () => {
      action.run(ctx);
      this._closeMenu();
    });
    return { item, extra: null };
  }

  _toggleMenu(title) {
    if (this._openMenu === title) {
      this._closeMenu();
    } else {
      this._openMenuFor(title);
    }
  }

  _openMenuFor(title) {
    this._closeMenu();
    const menu = this._menus.get(title);
    if (!menu) return;
    menu.dropdown.hidden = false;
    menu.wrapper.classList.add("open");
    this._openMenu = title;
    // Capture phase, same convention as `DiagramView._showContextMenu`: the
    // menu closes itself before any other handler reacts to the same click.
    this._onDocMousedown = (e) => {
      if (!menu.wrapper.contains(e.target)) this._closeMenu();
    };
    this._onDocKeydown = (e) => {
      if (e.key === "Escape") this._closeMenu();
    };
    document.addEventListener("mousedown", this._onDocMousedown, true);
    document.addEventListener("keydown", this._onDocKeydown, true);
  }

  _closeMenu() {
    if (!this._openMenu) return;
    const menu = this._menus.get(this._openMenu);
    if (menu) {
      menu.dropdown.hidden = true;
      menu.wrapper.classList.remove("open");
    }
    this._openMenu = null;
    document.removeEventListener("mousedown", this._onDocMousedown, true);
    document.removeEventListener("keydown", this._onDocKeydown, true);
  }

  /** Re-evaluates every item's `when(ctx)` guard against ITS OWN section's
   * `ctx`, e.g. `edit.deleteSelection` disables/enables as the diagram
   * selection changes, `project.closeTab` as the project's own tab list
   * changes — independently, since they read different context objects. */
  _render() {
    for (const menu of this._menus.values()) {
      for (const { action, ctx, item } of menu.entries) {
        const enabled = action.when(ctx);
        item.disabled = !enabled;
        item.classList.toggle("disabled", !enabled);
      }
    }
  }
}
