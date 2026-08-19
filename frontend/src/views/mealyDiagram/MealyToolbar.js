// Mealy's tool buttons — same "projection of the command registry" rule as
// `Toolbar.js` (design D6): every button just calls `action.run(ctx)`, no
// behavior of its own, sourced from `mealyRegistry.js`'s `MEALY_TOOL_IDS`.
// "Marcar inicial" is `state.markInitial` from that same registry (shared
// with the right-click context menu, `MealyDiagramView._onCanvasContextMenu`)
// instead of the ad-hoc post-construction callback this used before there
// was a Mealy registry to point at.

import { MEALY_TOOL_IDS, findMealyAction } from "../../commands/mealyRegistry.js";

/** Registry action id -> `ctx.activeTool` value, mirrors `Toolbar.js`'s
 * own `TOOL_NAMES`. */
const TOOL_NAMES = {
  "tool.select": "select",
  "tool.createState": "create-state",
  "tool.createTransition": "create-transition",
  "tool.delete": "delete",
};

const TOOL_ICONS = {
  "tool.select": "▸",
  "tool.createState": "◯",
  "tool.createTransition": "→",
  "tool.delete": "✕",
};

export class MealyToolbar {
  /**
   * @param {HTMLElement} container
   * @param {import('../../commands/MealyContext.js').MealyContext} ctx
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
    this.root.className = "toolbar mealy-toolbar";
    this.root.setAttribute("role", "toolbar");

    const toolsGroup = document.createElement("div");
    toolsGroup.className = "tool-group";
    toolsGroup.dataset.group = "tools";
    for (const id of MEALY_TOOL_IDS) {
      const action = findMealyAction(id);
      const button = this._buildActionButton(action);
      toolsGroup.appendChild(button);
      this._toolButtons.set(id, button);
    }

    const separator = document.createElement("div");
    separator.className = "toolbar-sep";

    this.markInitialButton = this._buildActionButton(findMealyAction("state.markInitial"), { showKeybinding: false });

    this.root.append(toolsGroup, separator, this.markInitialButton);
    this.container.appendChild(this.root);
  }

  /** @param {object} action registry action @param {{showKeybinding?: boolean}} [opts] */
  _buildActionButton(action, { showKeybinding = true } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tool-btn";
    button.dataset.action = action.id;
    button.append(`${TOOL_ICONS[action.id] ?? ""} ${action.title} `);
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
    this.markInitialButton.disabled = !findMealyAction("state.markInitial").when(this.ctx);
  }
}
