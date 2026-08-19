// L1: formal-definition-view (task 7.5, spec `formal-definition-view`).
// Renders M=(Q,Σ,δ,q0,F) as editable text, and applies a valid edit as an
// ops sequence against the shared `DocStore` (spec: "Valid edit applies
// everywhere") or shows an inline error and leaves the document untouched
// (spec: "Invalid edit rejected"). Lives inside the right column's upper
// tab group (main.js) — visibility is the tab's job now, not a `<details>`
// collapse toggle.

import {
  formatFormalText,
  parseFormalText,
  planStateDiff,
  planSyncOps,
} from "./formalLogic.js";

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

    const currentStates = this.docStore.getStates();
    const { toAddLabels, toRemoveIds } = planStateDiff(parsed.model.states, currentStates);

    const resolvedIdOf = new Map(currentStates.map((s) => [s.label, s.id]));

    if (toAddLabels.length) {
      const result = await this.docStore.apply(
        toAddLabels.map((label, i) => ({
          op: "AddState",
          label,
          x: 80 + i * 60,
          y: 80 + currentStates.length * 40,
        })),
      );
      for (const patch of result.patches) {
        if (patch.patch === "StateAdded") resolvedIdOf.set(patch.label, patch.id);
      }
    }
    if (toRemoveIds.length) {
      await this.docStore.apply(toRemoveIds.map((id) => ({ op: "RemoveState", id })));
      for (const id of toRemoveIds) {
        for (const [label, mappedId] of resolvedIdOf) {
          if (mappedId === id) resolvedIdOf.delete(label);
        }
      }
    }

    const stateAfterAddRemove = this.docStore.getStates();
    const edgesAfterAddRemove = this.docStore.getEdges();
    const ops = planSyncOps(parsed.model, resolvedIdOf, stateAfterAddRemove, edgesAfterAddRemove);
    if (ops.length) await this.docStore.apply(ops);
  }
}
