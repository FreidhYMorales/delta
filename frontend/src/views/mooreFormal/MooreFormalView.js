// Moore formal-definition view — mirrors `mealyFormal/MealyFormalView.js`'s
// shape (editable textarea, "Aplicar definición" button, inline error box,
// re-render only while not actively typing) for the Moore 6-tuple. Lives
// inside Moore's own upper tab group (main.js).

import { formatFormalText, parseFormalText } from "./mooreFormalLogic.js";
import { applyMooreModel } from "../../store/applyMooreModel.js";

export class MooreFormalView {
  /**
   * @param {HTMLElement} container
   * @param {import('../../store/MooreDocStore.js').MooreDocStore} docStore
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
    this.root.className = "formal-view moore-formal-view";

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
    await applyMooreModel(this.docStore, parsed.model);
  }
}
