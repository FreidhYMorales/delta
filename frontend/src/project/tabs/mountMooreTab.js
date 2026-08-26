// Mounts one Moore machine tab's whole document view (design D11, PR11) — a
// verbatim extraction of the Moore-specific block `main.js` used to build
// exactly once at app boot, now built once PER OPEN MOORE TAB by `TabHost`.
// Same "isolated, not a variant" rationale as `mountMealyTab.js` (this file
// is a SEPARATE module, not a shared parameterized mounter).

import { MooreDocStore } from "../../store/MooreDocStore.js";
import { MooreContext } from "../../commands/MooreContext.js";
import { MooreDiagramView } from "../../views/mooreDiagram/MooreDiagramView.js";
import { MooreToolbar } from "../../views/mooreDiagram/MooreToolbar.js";
import { MooreSimView } from "../../views/mooreDiagram/MooreSimView.js";
import { MooreTableView } from "../../views/mooreTable/MooreTableView.js";
import { MooreFormalView } from "../../views/mooreFormal/MooreFormalView.js";
import { promptModal } from "../../ui/promptModal.js";
import { applyGreekSymbols } from "../../store/greekSymbols.js";
import { pickOpenJsonPath, pickSaveJsonPath } from "../../ui/nativeDialog.js";
import { showNotice } from "../../ui/notice.js";
import { createTabs } from "../../ui/tabs.js";
import { wireResizer } from "../../ui/resizer.js";
import { wireSidebarToggle } from "../../ui/sidebarToggle.js";
import { bindMooreTab } from "../../tauri/tabClient.js";

/**
 * @param {number} tabId
 * @param {{contentHost: HTMLElement, toolbarHost: HTMLElement}} hosts
 * @param {typeof import('../../tauri/client.js')} client
 * @param {{projectStore?: import('../ProjectStore.js').ProjectStore}} [collaborators]
 */
export function mountMooreTab(tabId, hosts, client, collaborators = {}) {
  const { contentHost, toolbarHost } = hosts;
  const { projectStore } = collaborators;
  const boundClient = bindMooreTab(client, tabId);

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

  const docStore = new MooreDocStore(boundClient);
  // Threads this tab's own revision back to the project-level store (design
  // D10) — see `mountFaTab.js`'s identical wiring for why this is needed.
  docStore.subscribe(() => projectStore?.updateTabRevision?.(tabId, docStore.revision));

  const ctx = new MooreContext(docStore, {
    promptLabel: async (id) => {
      const state = docStore.getState(id);
      return promptModal("Rename state", state?.label ?? "");
    },
    promptInput: async (existing = "") => {
      const value = await promptModal("Transición (símbolo de entrada, p.ej. a)", existing);
      return value ? applyGreekSymbols(value) : value;
    },
    promptOutput: async (id) => {
      const state = docStore.getState(id);
      const value = await promptModal("Salida del estado", state?.output ?? "");
      return value ? applyGreekSymbols(value) : value;
    },
    openFile: async () => {
      const path = await pickOpenJsonPath();
      if (!path) return;
      try {
        const snapshot = await boundClient.mooreOpen(path);
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
        await boundClient.mooreSave(path);
        docStore.setFilePath(path);
      } catch (error) {
        showNotice({ kind: "error", title: "No se pudo guardar el archivo", message: String(error?.message ?? error) });
      }
    },
  });
  const diagramView = new MooreDiagramView(canvasPane, docStore, ctx);
  ctx.viewport = diagramView.viewport;
  const toolbar = new MooreToolbar(toolbarHost, ctx);
  toolbar.root.hidden = true;

  const upperTabs = createTabs(panelUpper, [
    { id: "tabla", label: "Tabla de estados" },
    { id: "formal", label: "Definición formal" },
    { id: "simular", label: "Simular" },
  ]);
  new MooreTableView(upperTabs.panels.get("tabla"), docStore, ctx);
  new MooreFormalView(upperTabs.panels.get("formal"), docStore);
  new MooreSimView(upperTabs.panels.get("simular"), (input) => boundClient.mooreSim(input));

  docStore.load();

  return {
    tabId,
    kind: "Moore",
    root,
    toolbarRoot: toolbar.root,
    docStore,
    ctx,
    activate() {
      root.hidden = false;
      toolbar.root.hidden = false;
      ctx.viewport.fitToWindow();
      diagramView.svg.focus();
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
