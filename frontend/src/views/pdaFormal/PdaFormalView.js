// PDA formal-definition view — mirrors `mooreFormal/MooreFormalView.js`'s
// shape (editable textarea, "Aplicar definición" button, inline error box,
// re-render only while not actively typing) for PDA's 7-tuple
// M = (Q, Sigma, Gamma, delta, q0, Z0, F). Lives inside PDA's own upper tab
// group (main.js).

import { formatFormalText, parseFormalText } from "./pdaFormalLogic.js";
import { applyPdaModel } from "../../store/applyPdaModel.js";

export class PdaFormalView {
  /**
   * @param {HTMLElement} container
   * @param {import('../../store/PdaDocStore.js').PdaDocStore} docStore
   */
  constructor(container, docStore) {
    this.container = container;
    this.docStore = docStore;
    this._build();
    docStore.subscribe(() => this._renderIfNotEditing());
    this._render();
  }

  _build() {
    this.root = document.createElement("div");
    this.root.className = "formal-view pda-formal-view";

    this.textarea = document.createElement("textarea");
    this.applyButton = document.createElement("button");
    this.applyButton.type = "button";
    this.applyButton.className = "apply btn-primary";
    this.applyButton.textContent = "Aplicar definición";
    this.applyButton.addEventListener("click", () => {
      this._lastApplyPromise = this._onApply();
    });

    this.errorBox = document.createElement("div");
    this.errorBox.className = "formal-error";

    this.root.append(this.textarea, this.applyButton, this.errorBox);
    this.container.appendChild(this.root);
  }

  _renderIfNotEditing() {
    if (document.activeElement === this.textarea) return;
    this._render();
  }

  _render() {
    this.textarea.value = formatFormalText({
      states: this.docStore.getStates(),
      transitions: this.docStore.getTransitions(),
      derived: this.docStore.derived,
    });
  }

  async _onApply() {
    const parsed = parseFormalText(this.textarea.value);
    if (!parsed.ok) {
      this.errorBox.textContent = parsed.error;
      return;
    }
    this.errorBox.textContent = "";
    await applyPdaModel(this.docStore, parsed.model);
  }
}
