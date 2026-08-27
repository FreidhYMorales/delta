// Auto-update check (Tauri updater plugin, signed against the release
// pipeline's keypair — see docs/decisions.md). Same lazy dynamic-import
// convention as `ui/nativeDialog.js`/`tauri/client.js`: this module (and
// anything importing it) must load under Vitest/jsdom, which has no real
// Tauri webview/plugin bridge, without throwing at import time.

let updaterPromise;
function getUpdater() {
  if (!updaterPromise) updaterPromise = import("@tauri-apps/plugin-updater");
  return updaterPromise;
}

let processPromise;
function getProcess() {
  if (!processPromise) processPromise = import("@tauri-apps/plugin-process");
  return processPromise;
}

/**
 * Silently checks for a new release on boot. If one exists, asks the user
 * via a native confirm dialog (`@tauri-apps/plugin-dialog`, already a
 * dependency) before downloading, installing, and relaunching. A failed
 * check (offline, dev mode, no webview) is never worth interrupting the
 * user over, so it's swallowed rather than surfaced as an error notice.
 */
export async function checkForUpdates() {
  try {
    const { check } = await getUpdater();
    const update = await check();
    if (!update) return;

    const { ask } = await import("@tauri-apps/plugin-dialog");
    const install = await ask(`Hay una versión nueva disponible (${update.version}). ¿Instalarla ahora?`, {
      title: "Actualización disponible",
      kind: "info",
    });
    if (!install) return;

    await update.downloadAndInstall();
    const { relaunch } = await getProcess();
    await relaunch();
  } catch (error) {
    console.warn("Update check failed:", error);
  }
}
