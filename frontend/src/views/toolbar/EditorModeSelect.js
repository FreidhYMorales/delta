// The "Editor" mode dropdown — extracted out of `Toolbar.js` (previously
// bundled together) because it now has to do two genuinely different
// things depending on which option is picked, and needs to keep working
// (and stay visible) regardless of which tool-button toolbar `main.js` is
// currently showing:
//  - "Expresión Regular"/"Gramática Regular" stay menu-style jumps
//    (`findAction(id).run(ctx)` against the FA `ViewContext`, then reset
//    back to "Autómata Finito" — see docs/decisions.md) — not real modes.
//  - "Máquina de Mealy" is a REAL mode now: selecting it calls
//    `onSwitchMode("mealy")` and STAYS selected, same as "Autómata Finito"
//    stays selected while in the FA editor. `main.js` owns what "switching
//    mode" actually means (which canvas/toolbar/panels are visible).
// PDA/Turing machine stay honestly disabled placeholders — no editor
// exists for them yet.

import { EDITOR_MODE_IDS, findAction } from "../../commands/registry.js";

const FINITE_VALUE = "finite";
const MEALY_VALUE = "mealy";

export class EditorModeSelect {
  /**
   * @param {HTMLElement} container
   * @param {import('../../commands/context.js').ViewContext} ctx FA context, for the jump-style actions
   * @param {{onSwitchMode?: (mode: 'finite'|'mealy') => void}} [hooks]
   */
  constructor(container, ctx, { onSwitchMode } = {}) {
    this.container = container;
    this.ctx = ctx;
    this.onSwitchMode = onSwitchMode ?? (() => {});
    this._buildDom();
  }

  _buildDom() {
    this.root = document.createElement("div");
    this.root.className = "mode-select";
    const modeLabel = document.createElement("label");
    modeLabel.setAttribute("for", "editor-mode");
    modeLabel.textContent = "Editor";

    this.select = document.createElement("select");
    this.select.id = "editor-mode";

    const finiteOption = document.createElement("option");
    finiteOption.value = FINITE_VALUE;
    finiteOption.textContent = "Autómata Finito";
    this.select.appendChild(finiteOption);

    // Real JFLAP's own "New" menu order (gui.action.NewAction, decompiled —
    // docs/decisions.md): Mealy comes right after Finite Automaton, before
    // Pushdown/Turing.
    const mealyOption = document.createElement("option");
    mealyOption.value = MEALY_VALUE;
    mealyOption.textContent = "Máquina de Mealy";
    this.select.appendChild(mealyOption);

    for (const label of ["Autómata de Pila — próximamente", "Máquina de Turing — próximamente"]) {
      const option = document.createElement("option");
      option.textContent = label;
      option.disabled = true;
      this.select.appendChild(option);
    }

    for (const id of EDITOR_MODE_IDS) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = findAction(id).title;
      this.select.appendChild(option);
    }

    this.select.addEventListener("change", () => {
      const value = this.select.value;
      if (value === MEALY_VALUE || value === FINITE_VALUE) {
        this.onSwitchMode(value);
        return;
      }
      findAction(value)?.run(this.ctx);
      this.select.value = FINITE_VALUE;
    });

    this.root.append(modeLabel, this.select);
    this.container.appendChild(this.root);
  }

  /** Called by `main.js` when the mode changes for a reason other than
   * this select itself (there isn't one yet, but keeps the select's own
   * displayed value authoritative rather than assumed). */
  setMode(mode) {
    this.select.value = mode;
  }
}
