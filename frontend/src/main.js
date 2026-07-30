// App shell: wires the Tauri IPC client, DocStore, shared ViewContext and
// the three PR5 views (DiagramView/TableView/FormalView) together. Testing
// drawer (L2) and the interop/advanced menu (L3) are PR6 (tasks 7.6/7.7).

import "./style.css";
import * as client from "./tauri/client.js";
import { DocStore } from "./store/DocStore.js";
import { ViewContext } from "./commands/context.js";
import { DiagramView } from "./views/diagram/DiagramView.js";
import { TableView } from "./views/table/TableView.js";
import { FormalView } from "./views/formal/FormalView.js";
import { circleLayout } from "./views/diagram/geometry.js";
import { promptModal } from "./ui/promptModal.js";

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
    // they silently return `null`, so every rename/symbol/path prompt goes
    // through the in-app `promptModal` instead (plain DOM, no new dep).
    // TODO(PR6/L3): swap the path prompts for the Tauri dialog plugin once
    // the interop menu wiring lands (task 7.7).
    promptLabel: async (id) => {
      const state = docStore.getState(id);
      return promptModal("Rename state", state?.label ?? "");
    },
    promptSymbol: async () => (await promptModal("Transition symbol (blank = epsilon)")) || null,
    promptPath: async (kind) =>
      promptModal(kind === "open-jff" ? "Path to .jff file to import" : "Save .jff file as"),
    importJff: async (path) => {
      const result = await client.jffImport(path);
      docStore.loadSnapshot(result.snapshot);
      if (result.report.items.length) {
        // eslint-disable-next-line no-console
        console.warn("jff import report", result.report);
      }
    },
    exportJff: async (path) => {
      const report = await client.jffExport(path);
      if (report.items.length) {
        // eslint-disable-next-line no-console
        console.warn("jff export report", report);
      }
    },
    layout: { circle: () => circleLayoutAction(docStore) },
  });

  const diagramView = new DiagramView(diagramPane, docStore, ctx);
  ctx.viewport = diagramView.viewport;

  new TableView(rightDock, docStore);
  new FormalView(rightDock, docStore);

  await docStore.load();
}

main();
