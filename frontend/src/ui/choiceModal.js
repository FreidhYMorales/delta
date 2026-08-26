// 3-way "unsaved changes" modal (Save / Discard / Cancel) — used when closing
// a dirty tab, opening a different project, etc. (PR11 wires the actual
// callers; this PR only builds and unit-tests the modal itself). Same
// promise-based, plain DOM/CSS convention as `promptModal.js` — no new
// dependency, consistent with the rest of this vanilla-JS frontend.
//
// Unlike `promptModal`'s `string|null` result, this always resolves with
// exactly one of the 3 literal choices below — Escape/backdrop-click count
// as an explicit "cancel", never a 4th `null` path, so a caller can safely
// `switch` on the result without an extra nullish branch.

/** @typedef {"save"|"discard"|"cancel"} ChoiceModalResult */

/**
 * Shows a Save/Discard/Cancel modal and resolves with the user's choice.
 * @param {string} message
 * @returns {Promise<ChoiceModalResult>}
 */
export function choiceModal(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "choice-modal-overlay";

    const box = document.createElement("div");
    box.className = "choice-modal";

    const label = document.createElement("p");
    label.className = "choice-modal-message";
    label.textContent = message;

    const actions = document.createElement("div");
    actions.className = "choice-modal-actions";

    const discardButton = document.createElement("button");
    discardButton.type = "button";
    discardButton.className = "choice-modal-discard";
    discardButton.textContent = "Descartar";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "choice-modal-cancel";
    cancelButton.textContent = "Cancelar";

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "choice-modal-save";
    saveButton.textContent = "Guardar";

    actions.append(discardButton, cancelButton, saveButton);
    box.append(label, actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const close = (value) => {
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
      resolve(value);
    };

    function onKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close("cancel");
      }
    }

    saveButton.addEventListener("click", () => close("save"));
    discardButton.addEventListener("click", () => close("discard"));
    cancelButton.addEventListener("click", () => close("cancel"));
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) close("cancel");
    });
    document.addEventListener("keydown", onKeydown, true);

    saveButton.focus();
  });
}
