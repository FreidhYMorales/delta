// Top-level app menu bar (File / Edit / View / Test) — the UI/UX audit's fix
// for actions that had ZERO visible trigger anywhere (`jff.import`,
// `jff.export`, `test.singleTrace`, `test.batch`) and for keyboard-only
// actions with no visible affordance (undo/redo/zoom/fit/circle layout).
// Every item is READ from `commands/registry.js`, filtered by
// `action.group` — this is the same "menubar/toolbar/context-menu/palette
// are projections, nothing bypasses the registry" guarantee already
// enforced for the toolbar (`DiagramView.js`) and the state context menu
// (design D6, `registry.js`'s header comment). No item here defines its own
// behavior; clicking one only ever calls `action.run(ctx)`.
//
// Deliberately excludes the `tools` and `state` groups: those already have
// a good visible trigger (the diagram toolbar and the state right-click
// context menu, respectively), so mirroring them here would only add
// clutter without improving discoverability — this project's UI priority is
// "modernize the look, simplify visible tools", not a dense classic-JFLAP
// menu that repeats every surface.

import { actions } from "../../commands/registry.js";

/** Registry `group` -> menu title, in the order the menu bar renders them.
 * Exported so the reachability-audit test (`commands/registry.test.js`) has
 * ONE source of truth for "which groups the menu bar covers" instead of a
 * second hardcoded copy that could silently drift out of sync. */
export const MENU_GROUP_TITLES = {
  interop: "Archivo",
  edit: "Editar",
  view: "Ver",
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
   * @param {import('../../commands/context.js').ViewContext} ctx
   */
  constructor(container, ctx) {
    this.container = container;
    this.ctx = ctx;
    /** Group name of the currently open dropdown, or `null`. */
    this._openMenu = null;
    this._menus = new Map();

    this._buildDom();
    ctx.subscribe(() => this._render());
    this._render();
  }

  _buildDom() {
    this.root = document.createElement("nav");
    this.root.className = "menu-bar";
    this.root.setAttribute("aria-label", "Application menu");

    for (const [group, title] of Object.entries(MENU_GROUP_TITLES)) {
      const groupActions = actions.filter((a) => a.group === group);
      if (!groupActions.length) continue;

      const wrapper = document.createElement("div");
      wrapper.className = "menu-bar-menu";

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "menu-bar-item";
      trigger.textContent = title;
      trigger.addEventListener("click", () => this._toggleMenu(group));

      const dropdown = document.createElement("div");
      dropdown.className = "menu-dropdown";
      dropdown.hidden = true;

      const items = new Map();
      for (const action of groupActions) {
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

        item.addEventListener("click", () => {
          action.run(this.ctx);
          this._closeMenu();
        });
        dropdown.appendChild(item);
        items.set(action.id, item);
      }

      wrapper.append(trigger, dropdown);
      this.root.appendChild(wrapper);
      this._menus.set(group, { wrapper, trigger, dropdown, items, actions: groupActions });
    }

    this.container.appendChild(this.root);
  }

  _toggleMenu(group) {
    if (this._openMenu === group) {
      this._closeMenu();
    } else {
      this._openMenuFor(group);
    }
  }

  _openMenuFor(group) {
    this._closeMenu();
    const menu = this._menus.get(group);
    if (!menu) return;
    menu.dropdown.hidden = false;
    menu.wrapper.classList.add("open");
    this._openMenu = group;
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

  /** Re-evaluates every item's `when(ctx)` guard, e.g. `edit.deleteSelection`
   * disables/enables as the diagram selection changes. */
  _render() {
    for (const menu of this._menus.values()) {
      for (const action of menu.actions) {
        const enabled = action.when(this.ctx);
        const item = menu.items.get(action.id);
        item.disabled = !enabled;
        item.classList.toggle("disabled", !enabled);
      }
    }
  }
}
