// Mounts one Turing Machine tab's whole document view (design D11, PR11) —
// a verbatim extraction of the TM-specific block `main.js` used to build
// exactly once at app boot, now built once PER OPEN TM TAB by `TabHost`.
// Same "isolated, not a variant" rationale as `mountPdaTab.js`/
// `mountMealyTab.js`/`mountMooreTab.js` (this file is a SEPARATE module, not
// a shared parameterized mounter).

import { TmDocStore } from "../../store/TmDocStore.js";
import { TmContext } from "../../commands/TmContext.js";
import { TmDiagramView } from "../../views/tmDiagram/TmDiagramView.js";
import { TmToolbar } from "../../views/tmDiagram/TmToolbar.js";
import { TmSimView } from "../../views/tmDiagram/TmSimView.js";
import { TmTableView } from "../../views/tmTable/TmTableView.js";
import { TmFormalView } from "../../views/tmFormal/TmFormalView.js";
import { promptModal } from "../../ui/promptModal.js";
import { applyGreekSymbols } from "../../store/greekSymbols.js";
import { pickOpenJsonPath, pickSaveJsonPath } from "../../ui/nativeDialog.js";
import { showNotice } from "../../ui/notice.js";
import { createTabs } from "../../ui/tabs.js";
import { wireResizer } from "../../ui/resizer.js";
import { wireSidebarToggle } from "../../ui/sidebarToggle.js";
import { bindTmTab } from "../../tauri/tabClient.js";

/**
 * @param {number} tabId
 * @param {{contentHost: HTMLElement, toolbarHost: HTMLElement}} hosts
 * @param {typeof import('../../tauri/client.js')} client
 * @param {{projectStore?: import('../ProjectStore.js').ProjectStore}} [collaborators]
 */
export function mountTmTab(tabId, hosts, client, collaborators = {}) {
  const { contentHost, toolbarHost } = hosts;
  const { projectStore } = collaborators;
  const boundClient = bindTmTab(client, tabId);

  const root = document.createElement("div");
  root.className = "app-body";
  root.hidden = true;

  const canvasPane = document.createElement("div");
  canvasPane.className = "canvas-pane";
  const resizer = document.createElement("div");
  resizer.className = "resizer";
  const rightCol = document.createElement("div");
  rightCol.className = "right-col";
  const panelUpper = document.createElement("div");
  panelUpper.className = "panel-upper";
  rightCol.append(panelUpper);
  root.append(canvasPane, resizer, rightCol);
  contentHost.appendChild(root);

  wireResizer(resizer, root, canvasPane);
  wireSidebarToggle(resizer, canvasPane, rightCol);

  const docStore = new TmDocStore(boundClient);
  // Threads this tab's own revision back to the project-level store (design
  // D10) — see `mountFaTab.js`'s identical wiring for why this is needed.
  docStore.subscribe(() => projectStore?.updateTabRevision?.(tabId, docStore.revision));

  const ctx = new TmContext(docStore, {
    promptLabel: async (id) => {
      const state = docStore.getState(id);
      return promptModal("Rename state", state?.label ?? "");
    },
    promptTape: async (index, existing = "") => {
      const value = await promptModal(`Cinta ${index + 1} (formato: lee ; escribe , dirección — L/R/S)`, existing);
      return value ? applyGreekSymbols(value) : value;
    },
    openFile: async () => {
      const path = await pickOpenJsonPath();
      if (!path) return;
      try {
        const snapshot = await boundClient.tmOpen(path);
        docStore.loadSnapshot(snapshot);
        docStore.setFilePath(path);
      } catch (error) {
        showNotice({ kind: "error", title: "No se pudo abrir el archivo", message: String(error?.message ?? error) });
      }
    },
    saveFile: async () => {
      const path = await pickSaveJsonPath();
      if (!path) return;
      try {
        await boundClient.tmSave(path);
        docStore.setFilePath(path);
      } catch (error) {
        showNotice({ kind: "error", title: "No se pudo guardar el archivo", message: String(error?.message ?? error) });
      }
    },
  });
  const diagramView = new TmDiagramView(canvasPane, docStore, ctx);
  ctx.viewport = diagramView.viewport;
  const toolbar = new TmToolbar(toolbarHost, ctx);
  toolbar.root.hidden = true;

  const upperTabs = createTabs(panelUpper, [
    { id: "tabla", label: "Tabla de estados" },
    { id: "formal", label: "Definición formal" },
    { id: "simular", label: "Simular" },
  ]);
  new TmTableView(upperTabs.panels.get("tabla"), docStore, ctx);
  new TmFormalView(upperTabs.panels.get("formal"), docStore);
  new TmSimView(upperTabs.panels.get("simular"), docStore, ctx, (inputs, acceptBy) => boundClient.tmSim(inputs, acceptBy));

  docStore.load();

  return {
    tabId,
    kind: "Tm",
    root,
    toolbarRoot: toolbar.root,
    docStore,
    ctx,
    activate() {
      root.hidden = false;
      toolbar.root.hidden = false;
      ctx.viewport.fitToWindow();
    },
    deactivate() {
      root.hidden = true;
      toolbar.root.hidden = true;
    },
    destroy() {
      root.remove();
      toolbar.root.remove();
    },
  };
}
