// L1: formal-definition-view (task 7.5, spec `formal-definition-view`).
// Renders M=(Q,Σ,δ,q0,F) as editable text, and applies a valid edit as an
// ops sequence against the shared `DocStore` (spec: "Valid edit applies
// everywhere") or shows an inline error and leaves the document untouched
// (spec: "Invalid edit rejected"). Lives inside the right column's upper
// tab group (main.js) — visibility is the tab's job now, not a `<details>`
// collapse toggle.

import { formatFormalText, parseFormalText } from "./formalLogic.js";
import { applyAutomatonModel } from "../../store/applyAutomatonModel.js";

export class FormalView {
  /**
   * @param {HTMLElement} container
   * @param {import('../../store/DocStore.js').DocStore} docStore
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
    this.root.className = "formal-view";

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
      edges: this.docStore.getEdges(),
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
    await applyAutomatonModel(this.docStore, parsed.model);
  }
}
