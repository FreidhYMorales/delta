// Minimal in-app replacement for `window.prompt()` (bug 2). Synchronous
// native dialogs are not reliably supported on webkit2gtk (Linux Tauri
// webview) — `window.prompt()` silently returns `null`, which made
// rename-via-dblclick and every transition-symbol prompt appear to do
// nothing. Plain DOM/CSS, no new dependency, consistent with the rest of
// the frontend's vanilla-JS style (design D6).

/**
 * Show a single-input modal dialog and resolve with the entered value, or
 * `null` if the user cancels (Cancel button, Escape key, or clicking the
 * backdrop outside the modal box).
 * @param {string} message
 * @param {string} [defaultValue]
 * @returns {Promise<string|null>}
 */
export function promptModal(message, defaultValue = "") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "prompt-modal-overlay";

    const box = document.createElement("div");
    box.className = "prompt-modal";

    const label = document.createElement("p");
    label.className = "prompt-modal-message";
    label.textContent = message;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "prompt-modal-input";
    input.value = defaultValue;

    const actions = document.createElement("div");
    actions.className = "prompt-modal-actions";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "prompt-modal-cancel";
    cancelButton.textContent = "Cancel";

    const okButton = document.createElement("button");
    okButton.type = "button";
    okButton.className = "prompt-modal-ok";
    okButton.textContent = "OK";

    actions.append(cancelButton, okButton);
    box.append(label, input, actions);
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
        close(null);
      } else if (event.key === "Enter") {
        event.preventDefault();
        close(input.value);
      }
    }

    okButton.addEventListener("click", () => close(input.value));
    cancelButton.addEventListener("click", () => close(null));
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) close(null);
    });
    document.addEventListener("keydown", onKeydown, true);

    input.focus();
    input.select();
  });
}
