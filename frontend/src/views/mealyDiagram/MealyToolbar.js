// Mealy's tool buttons — same 4-tool shape as `Toolbar.js`'s tools group,
// but not registry-driven (no `MealyContext` command registry yet, see
// `MealyDiagramView.js`'s header comment) — buttons call `ctx.setTool(...)`
// directly. "Marcar inicial" replaces `DiagramView`'s context-menu-only
// `state.markInitial`: it needs the live `MealyDiagramView` instance
// (`markInitial()`), handed over post-construction by `main.js`, same
// "post-construction handoff" pattern as `ctx.testing = testingView.controls`.

const TOOLS = [
  { id: "select", label: "Seleccionar", icon: "▸" },
  { id: "create-state", label: "Estado", icon: "◯" },
  { id: "create-transition", label: "Transición", icon: "→" },
  { id: "delete", label: "Borrar", icon: "✕" },
];

export class MealyToolbar {
  /**
   * @param {HTMLElement} container
   * @param {import('../../commands/MealyContext.js').MealyContext} ctx
   */
  constructor(container, ctx) {
    this.container = container;
    this.ctx = ctx;
    this._toolButtons = new Map();
    /** Wired post-construction by `main.js` to the live `MealyDiagramView`'s
     * `markInitial()` — safe no-op until then. */
    this.markInitial = () => {};

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
    for (const tool of TOOLS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tool-btn";
      button.dataset.tool = tool.id;
      button.textContent = `${tool.icon} ${tool.label} `;
      button.addEventListener("click", () => this.ctx.setTool(tool.id));
      toolsGroup.appendChild(button);
      this._toolButtons.set(tool.id, button);
    }

    const separator = document.createElement("div");
    separator.className = "toolbar-sep";

    this.markInitialButton = document.createElement("button");
    this.markInitialButton.type = "button";
    this.markInitialButton.className = "tool-btn";
    this.markInitialButton.textContent = "Marcar inicial";
    this.markInitialButton.addEventListener("click", () => this.markInitial());

    this.root.append(toolsGroup, separator, this.markInitialButton);
    this.container.appendChild(this.root);
  }

  _render() {
    for (const [id, button] of this._toolButtons) {
      button.classList.toggle("active", id === this.ctx.activeTool);
    }
    this.markInitialButton.disabled = this.ctx.selection?.kind !== "state";
  }
}
