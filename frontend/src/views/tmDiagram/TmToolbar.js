// TM's tool buttons — same "projection of the command registry" rule as
// `PdaToolbar.js`/`MooreToolbar.js`/`MealyToolbar.js`/`Toolbar.js` (design
// D6): every button just calls `action.run(ctx)`, no behavior of its own,
// sourced from `tmRegistry.js`'s `TM_TOOL_IDS`. "Marcar inicial" and
// "Alternar aceptación" are `state.markInitial`/`state.toggleAccepting` from
// that same registry (shared with the right-click context menu,
// `TmDiagramView._onCanvasContextMenu`), same as PDA's.
//
// New, no PDA equivalent: the tape-count `<select>` (real JFLAP's own
// "Turing Machine" vs. "Multi-Tape Turing Machine" `NewAction` split,
// decompiled this session, collapsed into one control since this project
// has no separate "New Document" step — see the TM frontend round's spec).
// Its effective value is `docStore.derived.tape_count > 0 ? that : ctx.tapeCountChoice`
// (`tmLogic.js`'s `effectiveTapeCount`), and it's disabled once
// `TmDoc::tape_count` is locked (backend-side, on the first-ever
// transition) — the backend silently rejects a transition with a different
// tape count once locked, so the UI reflects that it's fixed.

import { TM_TOOL_IDS, findTmAction } from "../../commands/tmRegistry.js";
import { effectiveTapeCount } from "./tmLogic.js";

/** Registry action id -> `ctx.activeTool` value, mirrors `PdaToolbar.js`'s
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

const TAPE_COUNT_OPTIONS = [1, 2, 3, 4, 5];

export class TmToolbar {
  /**
   * @param {HTMLElement} container
   * @param {import('../../commands/TmContext.js').TmContext} ctx
   */
  constructor(container, ctx) {
    this.container = container;
    this.ctx = ctx;
    this._toolButtons = new Map();

    this._buildDom();
    ctx.docStore.subscribe(() => this._render());
    ctx.subscribe(() => this._render());
    this._render();
  }

  _buildDom() {
    this.root = document.createElement("div");
    this.root.className = "toolbar tm-toolbar";
    this.root.setAttribute("role", "toolbar");

    const toolsGroup = document.createElement("div");
    toolsGroup.className = "tool-group";
    toolsGroup.dataset.group = "tools";
    for (const id of TM_TOOL_IDS) {
      const action = findTmAction(id);
      const button = this._buildActionButton(action);
      toolsGroup.appendChild(button);
      this._toolButtons.set(id, button);
    }

    const separator = document.createElement("div");
    separator.className = "toolbar-sep";

    this.markInitialButton = this._buildActionButton(findTmAction("state.markInitial"), { showKeybinding: false });
    this.toggleAcceptingButton = this._buildActionButton(findTmAction("state.toggleAccepting"), { showKeybinding: false });

    const tapeCountLabel = document.createElement("label");
    tapeCountLabel.className = "tm-tape-count-label";
    tapeCountLabel.textContent = "Cintas";
    tapeCountLabel.setAttribute("for", "tm-tape-count");

    this.tapeCountSelect = document.createElement("select");
    this.tapeCountSelect.id = "tm-tape-count";
    this.tapeCountSelect.className = "tm-tape-count-select";
    for (const n of TAPE_COUNT_OPTIONS) {
      const option = document.createElement("option");
      option.value = String(n);
      option.textContent = String(n);
      this.tapeCountSelect.appendChild(option);
    }
    this.tapeCountSelect.addEventListener("change", () => {
      this.ctx.setTapeCountChoice(Number(this.tapeCountSelect.value));
    });

    this.root.append(
      toolsGroup,
      separator,
      this.markInitialButton,
      this.toggleAcceptingButton,
      tapeCountLabel,
      this.tapeCountSelect,
    );
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
    this.markInitialButton.disabled = !findTmAction("state.markInitial").when(this.ctx);
    this.toggleAcceptingButton.disabled = !findTmAction("state.toggleAccepting").when(this.ctx);

    const locked = (this.ctx.docStore.derived?.tape_count ?? 0) > 0;
    this.tapeCountSelect.value = String(effectiveTapeCount(this.ctx.docStore, this.ctx));
    this.tapeCountSelect.disabled = locked;
  }
}
