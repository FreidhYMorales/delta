// App shell: wires the Tauri IPC client, DocStore, shared ViewContext and
// the app's views together (PR5's DiagramView/TableView/FormalView plus
// PR6's TestingView — L2 testing drawer, task 7.6). The L3 interop menu
// (task 7.7) reuses `jff.import`/`jff.export`, already registered since
// PR5, now wired to real native file dialogs below.

import "./style.css";
import * as client from "./tauri/client.js";
import { DocStore } from "./store/DocStore.js";
import { ViewContext } from "./commands/context.js";
import { DiagramView } from "./views/diagram/DiagramView.js";
import { TableView } from "./views/table/TableView.js";
import { FormalView } from "./views/formal/FormalView.js";
import { TestingView } from "./views/testing/TestingView.js";
import { circleLayout } from "./views/diagram/geometry.js";
import { promptModal } from "./ui/promptModal.js";
import { pickOpenPath, pickSavePath } from "./ui/nativeDialog.js";
import { showNotice } from "./ui/notice.js";
import { reportItemLines, reportTitle } from "./ui/interopReport.js";

function circleLayoutAction(docStore) {
  const states = docStore.getStates();
  if (!states.length) return;
  const radius = Math.min(160, 60 + states.length * 8);
  const positions = circleLayout(states, { centerX: 300, centerY: 200, radius });
  docStore.apply(positions.map((p) => ({ op: "MoveState", id: p.id, x: p.x, y: p.y })));
}

async function main() {
  const app = document.querySelector("#app");
  app.innerHTML = "";

  const shell = document.createElement("div");
  shell.className = "app-shell";
  const diagramPane = document.createElement("div");
  diagramPane.className = "diagram-pane";
  const rightDock = document.createElement("div");
  rightDock.className = "right-dock";
  shell.append(diagramPane, rightDock);
  app.appendChild(shell);

  const docStore = new DocStore(client);

  const ctx = new ViewContext(docStore, {
    // Bug 2: `window.prompt()`/`alert()`/`confirm()` are not reliably
    // supported by this project's Tauri webview (webkit2gtk on Linux) —
    // they silently return `null`, so rename/symbol prompts still go
    // through the in-app `promptModal` (plain DOM, no new dep). The two
    // path prompts (task 7.7) now open a real native file dialog instead —
    // `promptModal` never asks the user to *type* a filesystem path.
    promptLabel: async (id) => {
      const state = docStore.getState(id);
      return promptModal("Rename state", state?.label ?? "");
    },
    promptSymbol: async () => (await promptModal("Transition symbol (blank = epsilon)")) || null,
    promptPath: async (kind) => (kind === "open-jff" ? pickOpenPath() : pickSavePath()),
    importJff: async (path) => {
      try {
        const result = await client.jffImport(path);
        docStore.loadSnapshot(result.snapshot);
        // spec `jflap-interop` > "Visible Loss Report on Lossy Conversion":
        // a non-empty report is always shown, never swallowed/console-only.
        if (result.report.items.length) {
          showNotice({
            kind: "info",
            title: reportTitle(result.report),
            message: "Some elements were changed, approximated, or dropped on import:",
            items: reportItemLines(result.report),
          });
        }
      } catch (error) {
        showNotice({ kind: "error", title: "Import failed", message: String(error) });
      }
    },
    exportJff: async (path) => {
      try {
        const report = await client.jffExport(path);
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
    simTrace: (word, budget) => client.simTrace(word, budget),
    simBatch: (words, budget) => client.simBatch(words, budget),
    layout: { circle: () => circleLayoutAction(docStore) },
  });

  const diagramView = new DiagramView(diagramPane, docStore, ctx);
  ctx.viewport = diagramView.viewport;
  ctx.setActiveStates = (ids) => diagramView.setActiveStates(ids);

  new TableView(rightDock, docStore);
  new FormalView(rightDock, docStore);
  const testingView = new TestingView(diagramPane, docStore, ctx);
  ctx.testing = testingView.controls;

  await docStore.load();
}

main();
