// App shell: wires the Tauri IPC client, the project session, the shared
// `MenuBar`/`ProjectTabStrip`, and the per-tab document mounts together
// (design D8/D9/D11, PR11 — the multi-tab-projects cutover). Every open
// tab's own document view is built by exactly one `mountXTab` factory
// (`project/tabs/`), dispatched by kind through `TabHost` — this file no
// longer builds any per-kind canvas/toolbar/panel DOM itself, that block
// moved out to each `mountXTab.js` (see their own header comments for why
// they stay 5 separate modules, not one parameterized mounter).
//
// Layout: menu bar, the project tab strip, the toolbar row (one toolbar
// PER OPEN TAB now, not per kind — `TabHost`/each mount factory toggles
// `hidden` on whichever one belongs to the active tab), then the shared
// content host holding every open tab's own `.app-body` (also toggled
// `hidden`, never removed — design D11: a tab's whole view stays mounted for
// its entire lifetime once created).
//
// The shared `MenuBar` is rebuilt (not just re-rendered) every time the
// active tab changes: `ProjectContext`'s own "Archivo"/tab-management
// sections are always present, and whichever kind is currently active
// contributes its OWN registry's menu-worthy groups (today just "Editar" for
// Mealy/Moore/Pda/Tm, and Fa's full Archivo/Editar/Ver/Convertir/Test set —
// see each registry's own `*_MENU_GROUP_TITLES`). There is no single shared
// `ctx` anymore once more than one tab of the same kind can be open at
// once, so the menu can only ever bind to whichever tab's own `ctx` is
// currently active.

import "./style.css";
import * as client from "./tauri/client.js";
import { MenuBar, MENU_GROUP_TITLES } from "./views/menubar/MenuBar.js";
import { actions, keybindingOf } from "./commands/registry.js";
import { MEALY_MENU_GROUP_TITLES, mealyActions } from "./commands/mealyRegistry.js";
import { MOORE_MENU_GROUP_TITLES, mooreActions } from "./commands/mooreRegistry.js";
import { PDA_MENU_GROUP_TITLES, pdaActions } from "./commands/pdaRegistry.js";
import { TM_MENU_GROUP_TITLES, tmActions } from "./commands/tmRegistry.js";
import { ProjectStore } from "./project/ProjectStore.js";
import { ProjectContext } from "./commands/ProjectContext.js";
import {
  projectActions,
  PROJECT_MENU_GROUP_TITLES,
  confirmDiscardIfDirty,
  confirmDiscardTabIfDirty,
  findProjectActionByKeybinding,
} from "./commands/projectRegistry.js";
import { ProjectTabStrip } from "./views/projectTabs/ProjectTabStrip.js";
import { TabHost } from "./project/TabHost.js";
import { RecentProjects } from "./project/recentProjects.js";
import { MACHINE_KINDS, machineKindLabel } from "./project/machineKinds.js";
import { promptModal } from "./ui/promptModal.js";
import { newTabModal } from "./ui/newTabModal.js";
import { choiceModal } from "./ui/choiceModal.js";
import { pickOpenProjectPath, pickSaveProjectPath } from "./ui/nativeDialog.js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { checkForUpdates } from "./updater.js";

/** Registry `{actions, titles}` PER KIND — a plain DISPATCH lookup (which
 * registry to read from for a given active tab's `kind`), never a shared
 * behavioral generalization: every kind's own `actions`/`*_MENU_GROUP_TITLES`
 * still lives in its own separate registry module (docs/decisions.md). */
const KIND_REGISTRIES = {
  Fa: { actions, titles: MENU_GROUP_TITLES },
  Mealy: { actions: mealyActions, titles: MEALY_MENU_GROUP_TITLES },
  Moore: { actions: mooreActions, titles: MOORE_MENU_GROUP_TITLES },
  Pda: { actions: pdaActions, titles: PDA_MENU_GROUP_TITLES },
  Tm: { actions: tmActions, titles: TM_MENU_GROUP_TITLES },
};

async function main() {
  const app = document.querySelector("#app");
  app.innerHTML = "";

  const shell = document.createElement("div");
  shell.className = "app-shell";
  const menuBarHost = document.createElement("div");
  const tabStripHost = document.createElement("div");
  const toolbarHost = document.createElement("div");
  toolbarHost.className = "toolbar-row";
  const tabContentHost = document.createElement("div");
  tabContentHost.className = "tab-content-host";

  shell.append(menuBarHost, tabStripHost, toolbarHost, tabContentHost);
  app.appendChild(shell);

  const projectStore = new ProjectStore(client);
  const recentProjects = new RecentProjects(window.localStorage);
  const projectCtx = new ProjectContext(projectStore, {
    promptPath: async (kind) => (kind === "open-project" ? pickOpenProjectPath() : pickSaveProjectPath()),
    promptTabName: async (kind) =>
      promptModal(`Nombre para la nueva pestaña (${machineKindLabel(kind) ?? kind})`),
    promptNewTab: () => newTabModal(MACHINE_KINDS),
    confirmDiscard: () =>
      choiceModal("El proyecto actual tiene cambios sin guardar. ¿Querés guardarlos antes de continuar?"),
    recentProjects,
  });

  const tabHost = new TabHost({ contentHost: tabContentHost, toolbarHost }, client, projectStore);

  function projectMenus() {
    return Object.entries(PROJECT_MENU_GROUP_TITLES).map(([group, title]) => ({
      title,
      sections: [{ id: `project.${group}`, actions: projectActions.filter((a) => a.group === group), ctx: projectCtx }],
    }));
  }

  /** @param {object|undefined} mount the currently active tab's mount handle */
  function menusForActiveMount(mount) {
    const source = mount && KIND_REGISTRIES[mount.kind];
    if (!source) return [];
    return Object.entries(source.titles).map(([group, title]) => ({
      title,
      sections: [{ id: `${mount.kind}.${group}`, actions: source.actions.filter((a) => a.group === group), ctx: mount.ctx }],
    }));
  }

  let menuBar = null;
  /** Rebuilds the shared `MenuBar` from scratch for whichever tab (if any)
   * is now active — `MenuBar` has no API to swap its `menus` after
   * construction, and there is no single shared `ctx` to just re-render
   * against once more than one tab of the same kind can be open at once. */
  function rebuildMenuBar(mount) {
    menuBarHost.innerHTML = "";
    menuBar = new MenuBar(menuBarHost, [...projectMenus(), ...menusForActiveMount(mount)]);
  }

  const tabStrip = new ProjectTabStrip(tabStripHost, projectStore, {
    onActivate: (tabId) => {
      tabHost.activate(tabId);
      rebuildMenuBar(tabHost.getMount(tabId));
    },
    onDeactivate: (tabId) => {
      tabHost.deactivate(tabId);
    },
    confirmDiscardTab: (tabId) => confirmDiscardTabIfDirty(projectCtx, tabId),
  });

  // App boot (PR11): a fresh, empty project with exactly one empty Fa tab,
  // mounted and activated — `ProjectTabStrip`'s own `onActivate` above only
  // fires on a CHANGE of `activeTabId` (see its header comment), and the
  // very first tab is already active by the time the strip is constructed,
  // so it needs one explicit initial activation here instead.
  await projectStore.newProject();
  await projectStore.newTab("Fa", `${machineKindLabel("Fa")} 1`);
  const initialTabId = projectStore.activeTabId;
  if (initialTabId != null) {
    tabHost.activate(initialTabId);
    rebuildMenuBar(tabHost.getMount(initialTabId));
  } else {
    rebuildMenuBar(undefined);
  }

  // Quitting the app (window close, not a menu action) discards the whole
  // project the same way "Nuevo proyecto"/"Abrir proyecto" would, so it
  // gets the exact same guard. `getCurrentWindow()` throws outside a real
  // Tauri webview (e.g. under Vitest's jsdom, where `main.test.js` boots
  // this whole module with nothing else mocked) — skipped harmlessly there,
  // there's no real window to guard in that context anyway.
  try {
    getCurrentWindow().onCloseRequested(async (event) => {
      if (!(await confirmDiscardIfDirty(projectCtx))) event.preventDefault();
    });
  } catch {
    // Not running in a Tauri webview.
  }

  // Project-level shortcuts (Ctrl+N/O/S/Shift+S/W) had a `keybinding` on
  // their registry entry (commands/projectRegistry.js) purely as a menu
  // display hint — nothing ever matched an actual key PRESS against it.
  // `DiagramView._dispatchKey` only reads `commands/registry.js`'s own
  // `actions` (a deliberately separate registry, design D8), so these never
  // fired outside of clicking the Archivo menu (reported bug). Capture phase
  // so this always sees the keydown before it reaches the diagram canvas —
  // harmless, since no keybinding here collides with `registry.js`'s own.
  document.addEventListener(
    "keydown",
    (event) => {
      const action = findProjectActionByKeybinding(keybindingOf(event));
      if (!action || !action.when(projectCtx)) return;
      event.preventDefault();
      action.run(projectCtx);
    },
    true,
  );

  // Fire-and-forget: never delays the boot sequence above, and its own
  // try/catch (see updater.js) swallows a failed check silently — a bad
  // network on launch is not worth blocking the user over.
  void checkForUpdates();

  // Keep references reachable for the app's lifetime (avoids "unused"
  // lint/tooling noise on bindings this module never reads again by name).
  void tabStrip;
  void menuBar;
}

main();
