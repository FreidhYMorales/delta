// Native file-picker wrapper over the Tauri v2 dialog plugin
// (`@tauri-apps/plugin-dialog`, task 7.7). Replaces the PR5 stub where
// `promptPath` asked the user to *type* a path through `promptModal` —
// real OS open/save dialogs restricted to `.jff` files. Same lazy dynamic
// import as `tauri/client.js`, for the same reason: this module (and
// anything importing it) must load under Vitest/jsdom, which has no real
// Tauri webview/plugin bridge, without throwing at import time.

let dialogPromise;

function getDialog() {
  if (!dialogPromise) {
    dialogPromise = import("@tauri-apps/plugin-dialog");
  }
  return dialogPromise;
}

const JFF_FILTER = [{ name: "JFLAP file", extensions: ["jff"] }];

/** @returns {Promise<string|null>} the chosen path, or `null` if cancelled */
export async function pickOpenPath() {
  const { open } = await getDialog();
  const result = await open({ multiple: false, directory: false, filters: JFF_FILTER });
  return typeof result === "string" ? result : null;
}

/** @param {string} [defaultPath] @returns {Promise<string|null>} */
export async function pickSavePath(defaultPath = "automaton.jff") {
  const { save } = await getDialog();
  const result = await save({ defaultPath, filters: JFF_FILTER });
  return result ?? null;
}

// Native JSON only, for `MealyDoc` — no `.jff` support for Mealy machines
// yet (out of scope, docs/decisions.md), so these are separate filters
// rather than a shared FA/Mealy path picker.
const JSON_FILTER = [{ name: "Native JSON", extensions: ["json"] }];

/** @returns {Promise<string|null>} the chosen path, or `null` if cancelled */
export async function pickOpenJsonPath() {
  const { open } = await getDialog();
  const result = await open({ multiple: false, directory: false, filters: JSON_FILTER });
  return typeof result === "string" ? result : null;
}

/** @param {string} [defaultPath] @returns {Promise<string|null>} */
export async function pickSaveJsonPath(defaultPath = "mealy.json") {
  const { save } = await getDialog();
  const result = await save({ defaultPath, filters: JSON_FILTER });
  return result ?? null;
}
