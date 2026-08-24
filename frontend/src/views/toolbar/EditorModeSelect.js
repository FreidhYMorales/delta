// The "Editor" mode dropdown — extracted out of `Toolbar.js` (previously
// bundled together) because it now has to do two genuinely different
// things depending on which option is picked, and needs to keep working
// (and stay visible) regardless of which tool-button toolbar `main.js` is
// currently showing:
//  - "Expresión Regular"/"Gramática Regular" stay menu-style jumps
//    (`findAction(id).run(ctx)` against the FA `ViewContext`, then reset
//    back to "Autómata Finito" — see docs/decisions.md) — not real modes.
//  - "Máquina de Mealy"/"Máquina de Moore"/"Autómata de Pila"/"Máquina de
//    Turing" are REAL modes: selecting one calls `onSwitchMode(value)` and
//    STAYS selected, same as "Autómata Finito" stays selected while in the
//    FA editor. `main.js` owns what "switching mode" actually means (which
//    canvas/toolbar/panels are visible) — this component just reports the
//    chosen value.
//
// The set of real modes is passed in (`hooks.modes`), not hardcoded to a
// fixed count — Moore, PDA and now Turing were each added after Mealy, in
// case another editor ever follows (see docs/decisions.md), so a hardcoded
// branch here would need rewriting again for each new one.

import { EDITOR_MODE_IDS, findAction } from "../../commands/registry.js";

/** Real JFLAP's own "New" menu order (gui.action.NewAction, decompiled —
 * docs/decisions.md): Finite Automaton, Mealy, Moore, Pushdown, Turing. */
const DEFAULT_MODES = [
  { value: "finite", label: "Autómata Finito" },
  { value: "mealy", label: "Máquina de Mealy" },
  { value: "moore", label: "Máquina de Moore" },
  { value: "pda", label: "Autómata de Pila" },
  { value: "tm", label: "Máquina de Turing" },
];

export class EditorModeSelect {
  /**
   * @param {HTMLElement} container
   * @param {import('../../commands/context.js').ViewContext} ctx FA context, for the jump-style actions
   * @param {{
   *   onSwitchMode?: (mode: string) => void,
   *   modes?: {value: string, label: string}[],
   * }} [hooks]
   */
  constructor(container, ctx, { onSwitchMode, modes = DEFAULT_MODES } = {}) {
    this.container = container;
    this.ctx = ctx;
    this.onSwitchMode = onSwitchMode ?? (() => {});
    this.modes = modes;
    this._modeValues = new Set(modes.map((m) => m.value));
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

    for (const mode of this.modes) {
      const option = document.createElement("option");
      option.value = mode.value;
      option.textContent = mode.label;
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
      if (this._modeValues.has(value)) {
        this.onSwitchMode(value);
        return;
      }
      findAction(value)?.run(this.ctx);
      this.select.value = this.modes[0].value;
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
