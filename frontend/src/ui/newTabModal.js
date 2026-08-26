// "New tab" modal (kind + name), replacing the old one-menu-entry-per-kind
// "Nuevo: <kind>" design — a single "Nueva pestaña" action opens this
// instead. Same promise-based, plain DOM/CSS convention as
// `promptModal.js`/`choiceModal.js` — no new dependency, consistent with
// the rest of this vanilla-JS frontend.
//
// Resolves `{kind, name}` on Aceptar, or `null` on Cancelar/Escape/backdrop
// click — same "no 4th ambiguous state" discipline as `choiceModal`'s
// literal result set.

/** @typedef {{id: string, label: string}} MachineKindMeta */

/**
 * Shows a kind-select + name-input modal and resolves with the user's
 * choice.
 * @param {MachineKindMeta[]} kinds
 * @param {{defaultKind?: string, defaultName?: string}} [options]
 * @returns {Promise<{kind: string, name: string}|null>}
 */
export function newTabModal(kinds, options = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "new-tab-modal-overlay";

    const box = document.createElement("div");
    box.className = "new-tab-modal";

    const title = document.createElement("p");
    title.className = "new-tab-modal-title";
    title.textContent = "Nueva pestaña";

    const kindLabel = document.createElement("label");
    kindLabel.className = "new-tab-modal-label";
    kindLabel.textContent = "Tipo";
    const kindSelect = document.createElement("select");
    kindSelect.className = "new-tab-modal-kind";
    for (const kind of kinds) {
      const option = document.createElement("option");
      option.value = kind.id;
      option.textContent = kind.label;
      kindSelect.appendChild(option);
    }
    kindSelect.value = options.defaultKind ?? kinds[0]?.id;
    kindLabel.appendChild(kindSelect);

    const nameLabel = document.createElement("label");
    nameLabel.className = "new-tab-modal-label";
    nameLabel.textContent = "Nombre";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "new-tab-modal-name";
    nameInput.value = options.defaultName ?? "";
    nameLabel.appendChild(nameInput);

    const actions = document.createElement("div");
    actions.className = "new-tab-modal-actions";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "new-tab-modal-cancel";
    cancelButton.textContent = "Cancelar";

    const okButton = document.createElement("button");
    okButton.type = "button";
    okButton.className = "new-tab-modal-ok";
    okButton.textContent = "Aceptar";

    actions.append(cancelButton, okButton);
    box.append(title, kindLabel, nameLabel, actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const close = (value) => {
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
      resolve(value);
    };

    const commit = () => {
      const name = nameInput.value.trim();
      if (!name) return;
      close({ kind: kindSelect.value, name });
    };

    function onKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close(null);
      } else if (event.key === "Enter") {
        event.preventDefault();
        commit();
      }
    }

    okButton.addEventListener("click", commit);
    cancelButton.addEventListener("click", () => close(null));
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) close(null);
    });
    document.addEventListener("keydown", onKeydown, true);

    nameInput.focus();
    nameInput.select();
  });
}
