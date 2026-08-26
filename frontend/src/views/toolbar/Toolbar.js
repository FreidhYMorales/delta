// Full-width app toolbar (wireframe parity, docs/decisions.md "reescritura
// completa a paridad de píxel"): the artifact's `.toolbar` sits directly
// under `.menubar`, spanning both the canvas pane AND the right column — not
// scoped to the diagram's own pane. Split out of `DiagramView` (which used
// to build+own it) into its own view for exactly that reason: it needs to be
// a sibling of the canvas/right-col split in `main.js`, not a child of one
// side of it.
//
// Same "projection of the command registry" rule as MenuBar.js (design D6):
// every button just calls `action.run(ctx)` — no behavior lives here.
//
// PR11 (multi-tab-projects): the "Editor" mode `<select>` that used to sit
// alongside this toolbar is gone — a project can hold several open tabs of
// different kinds at once now (`ProjectTabStrip`), not one single editor
// mode you switch between, so there is no longer a single "current mode" for
// a select like that to represent.

import { TOOL_IDS, findAction } from "../../commands/registry.js";

/** Registry action id -> `ctx.activeTool` value, for highlighting the
 * active tool button (mirrors `ViewContext.setTool`'s argument). */
const TOOL_NAMES = {
  "tool.select": "select",
  "tool.createState": "create-state",
  "tool.createTransition": "create-transition",
  "tool.delete": "delete",
};

/** Toolbar glyphs, keyed by action id — kept local to this view (not on the
 * registry action itself) since `action.title` is shared with the menu bar,
 * which renders plain text without an icon column. */
const TOOL_ICONS = {
  "tool.select": "▸",
  "tool.createState": "◯",
  "tool.createTransition": "→",
  "tool.delete": "✕",
  "view.autoLayout": "⟲",
  "view.fitToWindow": "⤢",
};

/** Short toolbar-only labels for the two view/layout actions — the Ver menu
 * still shows their full `action.title` ("Organizar automáticamente", "Ajustar a
 * ventana"); the toolbar button is tighter, matching the wireframe exactly. */
const TOOLBAR_LABELS = {
  "view.autoLayout": "Organizar",
  "view.fitToWindow": "Ajustar",
};

const VIEW_TOOLBAR_IDS = ["view.autoLayout", "view.fitToWindow"];

export class Toolbar {
  /**
   * @param {HTMLElement} container
   * @param {import('../../commands/context.js').ViewContext} ctx
   */
  constructor(container, ctx) {
    this.container = container;
    this.ctx = ctx;
    this._toolButtons = new Map();

    this._buildDom();
    ctx.subscribe(() => this._render());
    this._render();
  }

  _buildDom() {
    this.root = document.createElement("div");
    this.root.className = "toolbar";
    this.root.setAttribute("role", "toolbar");

    const toolsGroup = document.createElement("div");
    toolsGroup.className = "tool-group";
    toolsGroup.dataset.group = "tools";
    for (const id of TOOL_IDS) {
      const action = findAction(id);
      const button = this._buildToolButton(action, { showKeybinding: true });
      toolsGroup.appendChild(button);
      this._toolButtons.set(id, button);
    }

    const separator = document.createElement("div");
    separator.className = "toolbar-sep";

    const viewGroup = document.createElement("div");
    viewGroup.className = "tool-group";
    viewGroup.dataset.group = "view";
    for (const id of VIEW_TOOLBAR_IDS) {
      const action = findAction(id);
      viewGroup.appendChild(this._buildToolButton(action, { showKeybinding: false }));
    }

    this.root.append(toolsGroup, separator, viewGroup);
    this.container.appendChild(this.root);
  }

  /** @param {object} action registry action @param {{showKeybinding: boolean}} opts */
  _buildToolButton(action, { showKeybinding }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tool-btn";
    button.dataset.action = action.id;
    button.append(`${TOOL_ICONS[action.id] ?? ""} ${TOOLBAR_LABELS[action.id] ?? action.title} `);

    if (showKeybinding && action.keybinding) {
      const kbd = document.createElement("kbd");
      kbd.textContent = action.keybinding.toUpperCase();
      button.appendChild(kbd);
    }

    button.addEventListener("click", () => action.run(this.ctx));
    return button;
  }

  _render() {
    for (const [id, button] of this._toolButtons) {
      button.classList.toggle("active", TOOL_NAMES[id] === this.ctx.activeTool);
    }
  }
}
