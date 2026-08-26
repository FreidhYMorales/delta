// Mounts one FA (finite automaton) tab's whole document view (design D11,
// PR11) — a verbatim extraction of the FA-specific block `main.js` used to
// build exactly once at app boot, now built once PER OPEN FA TAB by
// `TabHost`. Every view/store constructed here is IDENTICAL to before
// (`DocStore`, `ViewContext`, `DiagramView`, `Toolbar`, the upper tab group,
// `TestingView`) — only the DocStore's client is now `bindFaTab(client,
// tabId)` (design D6) instead of the bare `client` module, and this whole
// block now lives in its own `root`/toolbar pair instead of the single
// shared `appBody`/`toolbarHost` slot every tab used to share.
//
// D11 mount lifecycle: `root`/the toolbar both start `hidden` and stay
// mounted in the DOM for the tab's whole lifetime — `activate()`/
// `deactivate()` just toggle that, and `activate()` ALSO re-triggers
// `ctx.viewport.fitToWindow()`, since a hidden container measures 0x0 and
// anything sized while hidden (the diagram's own `_fitToWindow`) got it
// wrong.
//
// D12 .jff import cutover: `ctx.importJff` no longer replaces THIS tab's own
// document — it creates a BRAND NEW Fa tab (never overwriting whichever Fa
// tab happens to already be open), imports into it, activates it, and closes
// it again if the import fails. This needs the app-level `projectStore`/
// `tabHost` collaborators, not just this tab's own `client`/`docStore`.

import { DocStore } from "../../store/DocStore.js";
import { ViewContext } from "../../commands/context.js";
import { DiagramView } from "../../views/diagram/DiagramView.js";
import { TableView } from "../../views/table/TableView.js";
import { FormalView } from "../../views/formal/FormalView.js";
import { RegexView } from "../../views/regex/RegexView.js";
import { GrammarView } from "../../views/grammar/GrammarView.js";
import { TestingView } from "../../views/testing/TestingView.js";
import { Toolbar } from "../../views/toolbar/Toolbar.js";
import { forceDirectedLayout } from "../../views/diagram/geometry.js";
import { promptModal } from "../../ui/promptModal.js";
import { pickOpenPath, pickSavePath } from "../../ui/nativeDialog.js";
import { showNotice } from "../../ui/notice.js";
import { reportItemLines, reportTitle } from "../../ui/interopReport.js";
import { createTabs } from "../../ui/tabs.js";
import { wireResizer } from "../../ui/resizer.js";
import { wireSidebarToggle } from "../../ui/sidebarToggle.js";
import { applyAutomatonModel } from "../../store/applyAutomatonModel.js";
import { docSnapshotToModel } from "../../views/formal/formalLogic.js";
import { bindFaTab } from "../../tauri/tabClient.js";
import { machineKindLabel } from "../machineKinds.js";

/** @returns {Promise<unknown>|undefined} same helper `main.js` used to own —
 * see its own header comment there before this extraction. */
async function autoLayoutAction(docStore, ctx) {
  const states = docStore.getStates();
  if (!states.length) return undefined;
  const edges = docStore.getEdges();
  const positions = forceDirectedLayout(states, edges, { centerX: 300, centerY: 200 });
  const result = await docStore.apply(positions.map((p) => ({ op: "MoveState", id: p.id, x: p.x, y: p.y })));
  ctx.viewport.fitToWindow();
  return result;
}

/** @param {string} path @returns {string} the file's base name without its
 * extension, for the new tab's default name (D12) — more useful to the user
 * than a generic counter, since they just picked this exact file. */
function baseNameOf(path) {
  const fileName = path.split(/[/\\]/).pop() ?? path;
  return fileName.replace(/\.[^./\\]+$/, "") || machineKindLabel("Fa");
}

/**
 * @param {number} tabId
 * @param {{contentHost: HTMLElement, toolbarHost: HTMLElement}} hosts
 * @param {typeof import('../../tauri/client.js')} client
 * @param {{projectStore?: import('../ProjectStore.js').ProjectStore, tabHost?: import('../TabHost.js').TabHost}} [collaborators]
 */
export function mountFaTab(tabId, hosts, client, collaborators = {}) {
  const { contentHost, toolbarHost } = hosts;
  const { projectStore, tabHost } = collaborators;
  const boundClient = bindFaTab(client, tabId);

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
  const panelLower = document.createElement("div");
  panelLower.className = "panel-lower";
  rightCol.append(panelUpper, panelLower);
  root.append(canvasPane, resizer, rightCol);
  contentHost.appendChild(root);

  wireResizer(resizer, root, canvasPane);
  wireSidebarToggle(resizer, canvasPane, rightCol);

  const upperTabs = createTabs(
    panelUpper,
    [
      { id: "tabla", label: "Tabla de estados" },
      { id: "formal", label: "Definición formal" },
      { id: "regex", label: "Expresión regular" },
      { id: "grammar", label: "Gramática regular" },
    ],
    { collapsible: true },
  );

  const docStore = new DocStore(boundClient);

  const ctx = new ViewContext(docStore, {
    promptLabel: async (id) => {
      const state = docStore.getState(id);
      return promptModal("Rename state", state?.label ?? "");
    },
    promptSymbol: async () => (await promptModal("Transition symbol (blank = epsilon)")) || null,
    promptPath: async (kind) => (kind === "open-jff" ? pickOpenPath() : pickSavePath()),
    // D12 cutover: always creates a brand-new Fa tab and imports into THAT
    // one — never overwrites whichever Fa tab happens to already be open.
    // Closes the freshly created tab again if the import itself fails, so a
    // bad/incompatible .jff file never leaves an empty, broken tab behind.
    importJff: async (path) => {
      if (!projectStore || !tabHost) {
        throw new Error("mountFaTab: importJff needs both projectStore and tabHost collaborators");
      }
      let newTabId;
      try {
        await projectStore.newTab("Fa", baseNameOf(path));
        newTabId = projectStore.tabs.at(-1).id;
        const mount = tabHost.getMount(newTabId);
        const result = await client.jffImport(path, newTabId);
        mount.docStore.loadSnapshot(result.snapshot);
        mount.docStore.setFilePath(path);
        projectStore.setActiveTab(newTabId);
        if (result.report.items.length) {
          showNotice({
            kind: "info",
            title: reportTitle(result.report),
            message: "Some elements were changed, approximated, or dropped on import:",
            items: reportItemLines(result.report),
          });
        }
      } catch (error) {
        if (newTabId != null) await projectStore.closeTab(newTabId);
        showNotice({ kind: "error", title: "Import failed", message: String(error) });
      }
    },
    exportJff: async (path) => {
      try {
        const report = await boundClient.jffExport(path);
        docStore.setFilePath(path);
        if (report.items.length) {
          showNotice({
            kind: "info",
            title: reportTitle(report),
            message: "Some elements were changed, approximated, or dropped on export:",
            items: reportItemLines(report),
          });
        }
      } catch (error) {
        showNotice({ kind: "error", title: "Export failed", message: String(error) });
      }
    },
    simTrace: (word, budget) => boundClient.simTrace(word, budget),
    simBatch: (words, budget) => boundClient.simBatch(words, budget),
    toRegex: () => boundClient.convToRegex(),
    fromRegex: async (pattern) => {
      const snapshot = await boundClient.convFromRegex(pattern);
      docStore.loadSnapshot(snapshot);
      await autoLayoutAction(docStore, ctx);
      return snapshot;
    },
    toGrammar: () => boundClient.convToGrammar(),
    fromGrammar: async (text) => {
      const snapshot = await boundClient.convFromGrammar(text);
      docStore.loadSnapshot(snapshot);
      await autoLayoutAction(docStore, ctx);
      return snapshot;
    },
    convertToDfa: async () => {
      try {
        const preview = await boundClient.convNfaToDfa();
        await applyAutomatonModel(docStore, docSnapshotToModel(preview));
        await autoLayoutAction(docStore, ctx);
      } catch (error) {
        showNotice({ kind: "error", title: "Conversión a AFD falló", message: String(error?.message ?? error) });
      }
    },
    minimizeDfa: async () => {
      try {
        const preview = await boundClient.convMinimizeDfa();
        await applyAutomatonModel(docStore, docSnapshotToModel(preview));
        await autoLayoutAction(docStore, ctx);
      } catch (error) {
        showNotice({ kind: "error", title: "Minimización falló", message: String(error?.message ?? error) });
      }
    },
    layout: { arrange: () => autoLayoutAction(docStore, ctx) },
  });

  const diagramView = new DiagramView(canvasPane, docStore, ctx);
  ctx.viewport = diagramView.viewport;
  const toolbar = new Toolbar(toolbarHost, ctx);
  toolbar.root.hidden = true;

  new TableView(upperTabs.panels.get("tabla"), docStore, ctx);
  new FormalView(upperTabs.panels.get("formal"), docStore);
  new RegexView(upperTabs.panels.get("regex"), docStore, ctx);
  new GrammarView(upperTabs.panels.get("grammar"), docStore, ctx);
  const testingView = new TestingView(panelLower, docStore, ctx, {
    onCollapsedChange: (collapsed) => {
      panelLower.classList.toggle("tabs-collapsed", collapsed);
      panelUpper.classList.toggle("expand-full", collapsed);
    },
  });
  ctx.testing = testingView.controls;

  docStore.load();

  return {
    tabId,
    kind: "Fa",
    root,
    toolbarRoot: toolbar.root,
    docStore,
    ctx,
    /** D11: re-shows this tab's own root/toolbar AND re-triggers a fit —
     * a container measured while `hidden` (0x0) always fits wrong. */
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
