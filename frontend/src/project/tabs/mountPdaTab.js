// Mounts one Pushdown Automaton tab's whole document view (design D11,
// PR11) — a verbatim extraction of the PDA-specific block `main.js` used to
// build exactly once at app boot, now built once PER OPEN PDA TAB by
// `TabHost`. Same "isolated, not a variant" rationale as `mountMealyTab.js`/
// `mountMooreTab.js` (this file is a SEPARATE module, not a shared
// parameterized mounter). Table/Definición formal views are mounted here too
// (both already exist, unlike the state this block was in when it was first
// written directly into `main.js`).

import { PdaDocStore } from "../../store/PdaDocStore.js";
import { PdaContext } from "../../commands/PdaContext.js";
import { PdaDiagramView } from "../../views/pdaDiagram/PdaDiagramView.js";
import { PdaToolbar } from "../../views/pdaDiagram/PdaToolbar.js";
import { PdaSimView } from "../../views/pdaDiagram/PdaSimView.js";
import { PdaTableView } from "../../views/pdaTable/PdaTableView.js";
import { PdaFormalView } from "../../views/pdaFormal/PdaFormalView.js";
import { promptModal } from "../../ui/promptModal.js";
import { applyGreekSymbols } from "../../store/greekSymbols.js";
import { pickOpenJsonPath, pickSaveJsonPath } from "../../ui/nativeDialog.js";
import { showNotice } from "../../ui/notice.js";
import { createTabs } from "../../ui/tabs.js";
import { wireResizer } from "../../ui/resizer.js";
import { wireSidebarToggle } from "../../ui/sidebarToggle.js";
import { bindPdaTab } from "../../tauri/tabClient.js";

/**
 * @param {number} tabId
 * @param {{contentHost: HTMLElement, toolbarHost: HTMLElement}} hosts
 * @param {typeof import('../../tauri/client.js')} client
 * @param {{projectStore?: import('../ProjectStore.js').ProjectStore}} [collaborators]
 */
export function mountPdaTab(tabId, hosts, client, collaborators = {}) {
  const { contentHost, toolbarHost } = hosts;
  const { projectStore } = collaborators;
  const boundClient = bindPdaTab(client, tabId);

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

  const docStore = new PdaDocStore(boundClient);
  // Threads this tab's own revision back to the project-level store (design
  // D10) — see `mountFaTab.js`'s identical wiring for why this is needed.
  docStore.subscribe(() => projectStore?.updateTabRevision?.(tabId, docStore.revision));

  const ctx = new PdaContext(docStore, {
    promptLabel: async (id) => {
      const state = docStore.getState(id);
      return promptModal("Rename state", state?.label ?? "");
    },
    promptInput: async (existing = "") => {
      const value = await promptModal("Símbolo de entrada (vacío = ε)", existing);
      return value ? applyGreekSymbols(value) : value;
    },
    promptPop: async (existing = "") => {
      const value = await promptModal("Símbolos a desapilar (vacío = ε)", existing);
      return value ? applyGreekSymbols(value) : value;
    },
    promptPush: async (existing = "") => {
      const value = await promptModal("Símbolos a apilar (vacío = ε)", existing);
      return value ? applyGreekSymbols(value) : value;
    },
    openFile: async () => {
      const path = await pickOpenJsonPath();
      if (!path) return;
      try {
        const snapshot = await boundClient.pdaOpen(path);
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
        await boundClient.pdaSave(path);
        docStore.setFilePath(path);
      } catch (error) {
        showNotice({ kind: "error", title: "No se pudo guardar el archivo", message: String(error?.message ?? error) });
      }
    },
  });
  const diagramView = new PdaDiagramView(canvasPane, docStore, ctx);
  ctx.viewport = diagramView.viewport;
  const toolbar = new PdaToolbar(toolbarHost, ctx);
  toolbar.root.hidden = true;

  const upperTabs = createTabs(panelUpper, [
    { id: "tabla", label: "Tabla de estados" },
    { id: "formal", label: "Definición formal" },
    { id: "simular", label: "Simular" },
  ]);
  new PdaTableView(upperTabs.panels.get("tabla"), docStore, ctx);
  new PdaFormalView(upperTabs.panels.get("formal"), docStore);
  new PdaSimView(upperTabs.panels.get("simular"), (input, acceptBy) => boundClient.pdaSim(input, acceptBy));

  docStore.load();

  return {
    tabId,
    kind: "Pda",
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
