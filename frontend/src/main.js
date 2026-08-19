// App shell: wires the Tauri IPC client, DocStore, shared ViewContext and
// the app's views together. Layout is the plan worked out with the user
// (wireframe, this session): menu bar, canvas pane (60%, DiagramView owns
// its own internal toolbar), a draggable resizer, and a right column split
// into an upper tab group (Tabla de estados / Definición formal / Expresión
// regular / Gramática regular) and a lower tab group (TestingView's own
// Cadena/Lote/Resultados tabs) — see
// docs/decisions.md for the self-loop/curved-edge geometry that went with
// it. The L3 interop menu reuses `jff.import`/`jff.export`, wired to real
// native file dialogs below.

import "./style.css";
import * as client from "./tauri/client.js";
import { DocStore } from "./store/DocStore.js";
import { ViewContext } from "./commands/context.js";
import { DiagramView } from "./views/diagram/DiagramView.js";
import { TableView } from "./views/table/TableView.js";
import { FormalView } from "./views/formal/FormalView.js";
import { RegexView } from "./views/regex/RegexView.js";
import { GrammarView } from "./views/grammar/GrammarView.js";
import { TestingView } from "./views/testing/TestingView.js";
import { MenuBar } from "./views/menubar/MenuBar.js";
import { Toolbar } from "./views/toolbar/Toolbar.js";
import { circleLayout } from "./views/diagram/geometry.js";
import { promptModal } from "./ui/promptModal.js";
import { pickOpenPath, pickSavePath } from "./ui/nativeDialog.js";
import { showNotice } from "./ui/notice.js";
import { reportItemLines, reportTitle } from "./ui/interopReport.js";
import { createTabs } from "./ui/tabs.js";
import { wireResizer } from "./ui/resizer.js";

/** @returns {Promise<unknown>|undefined} the `docStore.apply` promise, so
 * callers that need to know the layout actually landed (e.g. `ctx.fromRegex`,
 * right after loading a regex-generated automaton whose states all start
 * stacked at (0,0) — `convert::regex_to_nfa` assigns no real coordinates)
 * can await it; the "Círculo" toolbar action ignores the return value, same
 * as before. */
function circleLayoutAction(docStore) {
  const states = docStore.getStates();
  if (!states.length) return undefined;
  const radius = Math.min(160, 60 + states.length * 8);
  const positions = circleLayout(states, { centerX: 300, centerY: 200, radius });
  return docStore.apply(positions.map((p) => ({ op: "MoveState", id: p.id, x: p.x, y: p.y })));
}

async function main() {
  const app = document.querySelector("#app");
  app.innerHTML = "";

  const shell = document.createElement("div");
  shell.className = "app-shell";
  const menuBarHost = document.createElement("div");
  const toolbarHost = document.createElement("div");
  const appBody = document.createElement("div");
  appBody.className = "app-body";

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

  appBody.append(canvasPane, resizer, rightCol);
  shell.append(menuBarHost, toolbarHost, appBody);
  app.appendChild(shell);
  wireResizer(resizer, appBody, canvasPane);

  const upperTabs = createTabs(panelUpper, [
    { id: "tabla", label: "Tabla de estados" },
    { id: "formal", label: "Definición formal" },
    { id: "regex", label: "Expresión regular" },
    { id: "grammar", label: "Gramática regular" },
  ]);

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
        docStore.setFilePath(path);
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
    simTrace: (word, budget) => client.simTrace(word, budget),
    simBatch: (words, budget) => client.simBatch(words, budget),
    toRegex: () => client.convToRegex(),
    openRegexTab: () => upperTabs.select("regex"),
    fromRegex: async (pattern) => {
      const snapshot = await client.convFromRegex(pattern);
      docStore.loadSnapshot(snapshot);
      // regex_to_nfa assigns no real (x, y) — every state lands at the
      // same point without this, on top of each other.
      await circleLayoutAction(docStore);
      return snapshot;
    },
    toGrammar: () => client.convToGrammar(),
    openGrammarTab: () => upperTabs.select("grammar"),
    fromGrammar: async (text) => {
      const snapshot = await client.convFromGrammar(text);
      docStore.loadSnapshot(snapshot);
      // regular_grammar_to_nfa assigns no real (x, y) either.
      await circleLayoutAction(docStore);
      return snapshot;
    },
    layout: { circle: () => circleLayoutAction(docStore) },
  });

  const diagramView = new DiagramView(canvasPane, docStore, ctx);
  ctx.viewport = diagramView.viewport;
  new Toolbar(toolbarHost, ctx);

  new TableView(upperTabs.panels.get("tabla"), docStore, ctx);
  new FormalView(upperTabs.panels.get("formal"), docStore);
  new RegexView(upperTabs.panels.get("regex"), docStore, ctx);
  new GrammarView(upperTabs.panels.get("grammar"), docStore, ctx);
  const testingView = new TestingView(panelLower, docStore, ctx);
  ctx.testing = testingView.controls;

  // Constructed last so its `when(ctx)` guards evaluate against the fully
  // wired context (real viewport/testing hooks, not their startup no-ops).
  new MenuBar(menuBarHost, ctx);

  await docStore.load();
}

main();
