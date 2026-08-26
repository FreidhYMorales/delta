// Mounts one Mealy machine tab's whole document view (design D11, PR11) — a
// verbatim extraction of the Mealy-specific block `main.js` used to build
// exactly once at app boot, now built once PER OPEN MEALY TAB by `TabHost`.
// Same "isolated, not a variant of the FA one" rationale as
// `MealyDocStore`/`MealyContext` themselves (docs/decisions.md) — this file
// is a SEPARATE module from `mountFaTab.js`, not a shared parameterized
// mounter with a kind switch inside it.

import { MealyDocStore } from "../../store/MealyDocStore.js";
import { MealyContext } from "../../commands/MealyContext.js";
import { MealyDiagramView } from "../../views/mealyDiagram/MealyDiagramView.js";
import { MealyToolbar } from "../../views/mealyDiagram/MealyToolbar.js";
import { MealySimView } from "../../views/mealyDiagram/MealySimView.js";
import { MealyTableView } from "../../views/mealyTable/MealyTableView.js";
import { MealyFormalView } from "../../views/mealyFormal/MealyFormalView.js";
import { promptModal } from "../../ui/promptModal.js";
import { pickOpenJsonPath, pickSaveJsonPath } from "../../ui/nativeDialog.js";
import { showNotice } from "../../ui/notice.js";
import { createTabs } from "../../ui/tabs.js";
import { wireResizer } from "../../ui/resizer.js";
import { wireSidebarToggle } from "../../ui/sidebarToggle.js";
import { bindMealyTab } from "../../tauri/tabClient.js";

/**
 * @param {number} tabId
 * @param {{contentHost: HTMLElement, toolbarHost: HTMLElement}} hosts
 * @param {typeof import('../../tauri/client.js')} client
 */
export function mountMealyTab(tabId, hosts, client) {
  const { contentHost, toolbarHost } = hosts;
  const boundClient = bindMealyTab(client, tabId);

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

  const docStore = new MealyDocStore(boundClient);
  const ctx = new MealyContext(docStore, {
    promptLabel: async (id) => {
      const state = docStore.getState(id);
      return promptModal("Rename state", state?.label ?? "");
    },
    promptTransition: async (existing = "") => promptModal("Transición (formato input/output, p.ej. a/x)", existing),
    openFile: async () => {
      const path = await pickOpenJsonPath();
      if (!path) return;
      try {
        const snapshot = await boundClient.mealyOpen(path);
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
        await boundClient.mealySave(path);
        docStore.setFilePath(path);
      } catch (error) {
        showNotice({ kind: "error", title: "No se pudo guardar el archivo", message: String(error?.message ?? error) });
      }
    },
  });
  const diagramView = new MealyDiagramView(canvasPane, docStore, ctx);
  ctx.viewport = diagramView.viewport;
  const toolbar = new MealyToolbar(toolbarHost, ctx);
  toolbar.root.hidden = true;

  const upperTabs = createTabs(panelUpper, [
    { id: "tabla", label: "Tabla de estados" },
    { id: "formal", label: "Definición formal" },
    { id: "simular", label: "Simular" },
  ]);
  new MealyTableView(upperTabs.panels.get("tabla"), docStore, ctx);
  new MealyFormalView(upperTabs.panels.get("formal"), docStore);
  new MealySimView(upperTabs.panels.get("simular"), (input) => boundClient.mealySim(input));

  docStore.load();

  return {
    tabId,
    kind: "Mealy",
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
