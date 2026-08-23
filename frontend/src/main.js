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
import { EditorModeSelect } from "./views/toolbar/EditorModeSelect.js";
import { circleLayout } from "./views/diagram/geometry.js";
import { promptModal } from "./ui/promptModal.js";
import { pickOpenJsonPath, pickOpenPath, pickSaveJsonPath, pickSavePath } from "./ui/nativeDialog.js";
import { showNotice } from "./ui/notice.js";
import { reportItemLines, reportTitle } from "./ui/interopReport.js";
import { createTabs } from "./ui/tabs.js";
import { wireResizer } from "./ui/resizer.js";
import { applyAutomatonModel } from "./store/applyAutomatonModel.js";
import { docSnapshotToModel } from "./views/formal/formalLogic.js";
import { MealyDocStore } from "./store/MealyDocStore.js";
import { MealyContext } from "./commands/MealyContext.js";
import { MealyDiagramView } from "./views/mealyDiagram/MealyDiagramView.js";
import { MealyToolbar } from "./views/mealyDiagram/MealyToolbar.js";
import { MealySimView } from "./views/mealyDiagram/MealySimView.js";
import { MealyTableView } from "./views/mealyTable/MealyTableView.js";
import { MealyFormalView } from "./views/mealyFormal/MealyFormalView.js";
import { MooreDocStore } from "./store/MooreDocStore.js";
import { MooreContext } from "./commands/MooreContext.js";
import { MooreDiagramView } from "./views/mooreDiagram/MooreDiagramView.js";
import { MooreToolbar } from "./views/mooreDiagram/MooreToolbar.js";
import { MooreSimView } from "./views/mooreDiagram/MooreSimView.js";
import { MooreTableView } from "./views/mooreTable/MooreTableView.js";
import { MooreFormalView } from "./views/mooreFormal/MooreFormalView.js";
import { PdaDocStore } from "./store/PdaDocStore.js";
import { PdaContext } from "./commands/PdaContext.js";
import { PdaDiagramView } from "./views/pdaDiagram/PdaDiagramView.js";
import { PdaToolbar } from "./views/pdaDiagram/PdaToolbar.js";
import { PdaSimView } from "./views/pdaDiagram/PdaSimView.js";
import { PdaTableView } from "./views/pdaTable/PdaTableView.js";
import { PdaFormalView } from "./views/pdaFormal/PdaFormalView.js";

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
  // Holds both tool-button toolbars (FA's `Toolbar`, Mealy's `MealyToolbar`
  // — only one visible at a time, toggled via their own `.root.hidden`)
  // plus the always-visible `EditorModeSelect` that switches between them —
  // all three appended as DIRECT children of this flex row (not wrapped in
  // extra host divs) so `.mode-select`'s own `margin-left: auto` still
  // pushes it to the right of whichever toolbar is showing. See
  // `EditorModeSelect.js`'s header comment for why the mode-select had to
  // move out of `Toolbar.js` for this.
  const toolbarHost = document.createElement("div");
  toolbarHost.className = "toolbar-row";

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

  // Mealy's own app-body — same canvas/right-col shape, a separate document
  // (`MealyDocStore`), never mounted alongside the FA one (see
  // `switchMode` below): only one of `appBody`/`mealyAppBody` is attached
  // to `shell` at a time.
  const mealyAppBody = document.createElement("div");
  mealyAppBody.className = "app-body";
  const mealyCanvasPane = document.createElement("div");
  mealyCanvasPane.className = "canvas-pane";
  const mealyResizer = document.createElement("div");
  mealyResizer.className = "resizer";
  const mealyRightCol = document.createElement("div");
  mealyRightCol.className = "right-col";
  const mealyPanelUpper = document.createElement("div");
  mealyPanelUpper.className = "panel-upper";
  mealyRightCol.append(mealyPanelUpper);
  mealyAppBody.append(mealyCanvasPane, mealyResizer, mealyRightCol);

  // Moore's own app-body — same shape as Mealy's, a separate document
  // (`MooreDocStore`), never mounted alongside FA's or Mealy's (see the
  // generalized `switchMode` below).
  const mooreAppBody = document.createElement("div");
  mooreAppBody.className = "app-body";
  const mooreCanvasPane = document.createElement("div");
  mooreCanvasPane.className = "canvas-pane";
  const mooreResizer = document.createElement("div");
  mooreResizer.className = "resizer";
  const mooreRightCol = document.createElement("div");
  mooreRightCol.className = "right-col";
  const moorePanelUpper = document.createElement("div");
  moorePanelUpper.className = "panel-upper";
  mooreRightCol.append(moorePanelUpper);
  mooreAppBody.append(mooreCanvasPane, mooreResizer, mooreRightCol);

  // PDA's own app-body — same shape as Mealy/Moore's, a separate document
  // (`PdaDocStore`), never mounted alongside the others (see the
  // generalized `switchMode` below).
  const pdaAppBody = document.createElement("div");
  pdaAppBody.className = "app-body";
  const pdaCanvasPane = document.createElement("div");
  pdaCanvasPane.className = "canvas-pane";
  const pdaResizer = document.createElement("div");
  pdaResizer.className = "resizer";
  const pdaRightCol = document.createElement("div");
  pdaRightCol.className = "right-col";
  const pdaPanelUpper = document.createElement("div");
  pdaPanelUpper.className = "panel-upper";
  pdaRightCol.append(pdaPanelUpper);
  pdaAppBody.append(pdaCanvasPane, pdaResizer, pdaRightCol);

  shell.append(menuBarHost, toolbarHost, appBody);
  app.appendChild(shell);
  wireResizer(resizer, appBody, canvasPane);
  wireResizer(mealyResizer, mealyAppBody, mealyCanvasPane);
  wireResizer(mooreResizer, mooreAppBody, mooreCanvasPane);
  wireResizer(pdaResizer, pdaAppBody, pdaCanvasPane);

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
    // "Convertir" menu: FA -> FA transforms, applied through the normal
    // `docStore.apply` undo/redo path (`applyAutomatonModel`) instead of a
    // whole-document swap — see docs/decisions.md for why this direction
    // differs from `fromRegex`/`fromGrammar` above.
    convertToDfa: async () => {
      try {
        const preview = await client.convNfaToDfa();
        await applyAutomatonModel(docStore, docSnapshotToModel(preview));
        await circleLayoutAction(docStore);
      } catch (error) {
        showNotice({ kind: "error", title: "Conversión a AFD falló", message: String(error?.message ?? error) });
      }
    },
    minimizeDfa: async () => {
      try {
        const preview = await client.convMinimizeDfa();
        await applyAutomatonModel(docStore, docSnapshotToModel(preview));
        await circleLayoutAction(docStore);
      } catch (error) {
        showNotice({ kind: "error", title: "Minimización falló", message: String(error?.message ?? error) });
      }
    },
    layout: { circle: () => circleLayoutAction(docStore) },
  });

  const diagramView = new DiagramView(canvasPane, docStore, ctx);
  ctx.viewport = diagramView.viewport;
  const faToolbar = new Toolbar(toolbarHost, ctx);

  new TableView(upperTabs.panels.get("tabla"), docStore, ctx);
  new FormalView(upperTabs.panels.get("formal"), docStore);
  new RegexView(upperTabs.panels.get("regex"), docStore, ctx);
  new GrammarView(upperTabs.panels.get("grammar"), docStore, ctx);
  const testingView = new TestingView(panelLower, docStore, ctx);
  ctx.testing = testingView.controls;

  // --- Mealy machine: a separate document/session, only mounted while
  // the mode select is on "Máquina de Mealy" — see docs/decisions.md for
  // why this is a genuinely separate document type rather than an FA
  // extension. -------------------------------------------------------------
  const mealyDocStore = new MealyDocStore(client);
  const mealyCtx = new MealyContext(mealyDocStore, {
    promptLabel: async (id) => {
      const state = mealyDocStore.getState(id);
      return promptModal("Rename state", state?.label ?? "");
    },
    // One prompt for the whole "input/output" pair (`parseTransitionPrompt`,
    // `mealyLogic.js`) — validated by the caller (`MealyDiagramView`), so
    // this hook only needs to surface the modal.
    promptTransition: async (existing = "") => promptModal("Transición (formato input/output, p.ej. a/x)", existing),
    // Native JSON only (no `.jff` for Mealy, no loss report — see
    // docs/decisions.md), so no try/catch-and-notice ceremony like FA's
    // importJff/exportJff: a cancelled dialog is just `path == null`.
    openFile: async () => {
      const path = await pickOpenJsonPath();
      if (!path) return;
      try {
        const snapshot = await client.mealyOpen(path);
        mealyDocStore.loadSnapshot(snapshot);
        mealyDocStore.setFilePath(path);
      } catch (error) {
        showNotice({ kind: "error", title: "No se pudo abrir el archivo", message: String(error?.message ?? error) });
      }
    },
    saveFile: async () => {
      const path = await pickSaveJsonPath();
      if (!path) return;
      try {
        await client.mealySave(path);
        mealyDocStore.setFilePath(path);
      } catch (error) {
        showNotice({ kind: "error", title: "No se pudo guardar el archivo", message: String(error?.message ?? error) });
      }
    },
  });
  const mealyDiagramView = new MealyDiagramView(mealyCanvasPane, mealyDocStore, mealyCtx);
  mealyCtx.viewport = mealyDiagramView.viewport;
  const mealyToolbar = new MealyToolbar(toolbarHost, mealyCtx);

  // Mealy's own upper tab group (Tabla de estados/Definición formal/
  // Simular) — mirrors the FA `upperTabs` group above, minus Regex/
  // Gramática (neither applies to a Mealy document, see docs/decisions.md).
  const mealyUpperTabs = createTabs(mealyPanelUpper, [
    { id: "tabla", label: "Tabla de estados" },
    { id: "formal", label: "Definición formal" },
    { id: "simular", label: "Simular" },
  ]);
  new MealyTableView(mealyUpperTabs.panels.get("tabla"), mealyDocStore, mealyCtx);
  new MealyFormalView(mealyUpperTabs.panels.get("formal"), mealyDocStore);
  new MealySimView(mealyUpperTabs.panels.get("simular"), (input) => client.mealySim(input));

  // --- Moore machine: a separate document/session, same "isolated, not a
  // variant" rationale as Mealy's (docs/decisions.md, the Moore backend
  // entry: output lives on the state, not the edge). ----------------------
  const mooreDocStore = new MooreDocStore(client);
  const mooreCtx = new MooreContext(mooreDocStore, {
    promptLabel: async (id) => {
      const state = mooreDocStore.getState(id);
      return promptModal("Rename state", state?.label ?? "");
    },
    // A single input symbol per prompt (`parseInputPrompt`, `mooreLogic.js`)
    // — no "input/output" pair like Mealy's `promptTransition`, Moore's
    // output lives on the state and is set via `promptOutput` below.
    promptInput: async (existing = "") => promptModal("Transición (símbolo de entrada, p.ej. a)", existing),
    promptOutput: async (id) => {
      const state = mooreDocStore.getState(id);
      return promptModal("Salida del estado", state?.output ?? "");
    },
    // Native JSON only (no `.jff` for Moore, same as Mealy — see
    // docs/decisions.md).
    openFile: async () => {
      const path = await pickOpenJsonPath();
      if (!path) return;
      try {
        const snapshot = await client.mooreOpen(path);
        mooreDocStore.loadSnapshot(snapshot);
        mooreDocStore.setFilePath(path);
      } catch (error) {
        showNotice({ kind: "error", title: "No se pudo abrir el archivo", message: String(error?.message ?? error) });
      }
    },
    saveFile: async () => {
      const path = await pickSaveJsonPath();
      if (!path) return;
      try {
        await client.mooreSave(path);
        mooreDocStore.setFilePath(path);
      } catch (error) {
        showNotice({ kind: "error", title: "No se pudo guardar el archivo", message: String(error?.message ?? error) });
      }
    },
  });
  const mooreDiagramView = new MooreDiagramView(mooreCanvasPane, mooreDocStore, mooreCtx);
  mooreCtx.viewport = mooreDiagramView.viewport;
  const mooreToolbar = new MooreToolbar(toolbarHost, mooreCtx);

  const mooreUpperTabs = createTabs(moorePanelUpper, [
    { id: "tabla", label: "Tabla de estados" },
    { id: "formal", label: "Definición formal" },
    { id: "simular", label: "Simular" },
  ]);
  new MooreTableView(mooreUpperTabs.panels.get("tabla"), mooreDocStore, mooreCtx);
  new MooreFormalView(mooreUpperTabs.panels.get("formal"), mooreDocStore);
  new MooreSimView(mooreUpperTabs.panels.get("simular"), (input) => client.mooreSim(input));

  // --- Pushdown Automaton: a separate document/session, same "isolated,
  // not a variant" rationale as Mealy/Moore's (docs/decisions.md, the PDA
  // Tauri IPC entry: transitions are individually addressable, unlike
  // FA/Mealy/Moore's one-payload-per-edge shape). Table/Definición formal
  // views are out of scope this round (same as Moore's own first round) —
  // only "Simular" is mounted below. --------------------------------------
  const pdaDocStore = new PdaDocStore(client);
  const pdaCtx = new PdaContext(pdaDocStore, {
    promptLabel: async (id) => {
      const state = pdaDocStore.getState(id);
      return promptModal("Rename state", state?.label ?? "");
    },
    // The three fields of a transition, prompted in sequence
    // (`promptTransitionTriple`, `pdaRegistry.js`) — no single "input/output"
    // or "input" prompt like Mealy/Moore, a PDA transition needs
    // `(input, pop, push)`.
    promptInput: async (existing = "") => promptModal("Símbolo de entrada (vacío = ε)", existing),
    promptPop: async (existing = "") => promptModal("Símbolos a desapilar (vacío = ε)", existing),
    promptPush: async (existing = "") => promptModal("Símbolos a apilar (vacío = ε)", existing),
    // Native JSON only (no `.jff` for PDA, same as Mealy/Moore — see
    // docs/decisions.md).
    openFile: async () => {
      const path = await pickOpenJsonPath();
      if (!path) return;
      try {
        const snapshot = await client.pdaOpen(path);
        pdaDocStore.loadSnapshot(snapshot);
        pdaDocStore.setFilePath(path);
      } catch (error) {
        showNotice({ kind: "error", title: "No se pudo abrir el archivo", message: String(error?.message ?? error) });
      }
    },
    saveFile: async () => {
      const path = await pickSaveJsonPath();
      if (!path) return;
      try {
        await client.pdaSave(path);
        pdaDocStore.setFilePath(path);
      } catch (error) {
        showNotice({ kind: "error", title: "No se pudo guardar el archivo", message: String(error?.message ?? error) });
      }
    },
  });
  const pdaDiagramView = new PdaDiagramView(pdaCanvasPane, pdaDocStore, pdaCtx);
  pdaCtx.viewport = pdaDiagramView.viewport;
  const pdaToolbar = new PdaToolbar(toolbarHost, pdaCtx);

  const pdaUpperTabs = createTabs(pdaPanelUpper, [
    { id: "tabla", label: "Tabla de estados" },
    { id: "formal", label: "Definición formal" },
    { id: "simular", label: "Simular" },
  ]);
  new PdaTableView(pdaUpperTabs.panels.get("tabla"), pdaDocStore, pdaCtx);
  new PdaFormalView(pdaUpperTabs.panels.get("formal"), pdaDocStore);
  new PdaSimView(pdaUpperTabs.panels.get("simular"), (input, acceptBy) => client.pdaSim(input, acceptBy));

  // `modes` drives both the "Editor" dropdown's real-mode options and
  // `switchMode` below — a small registry instead of a hardcoded N-way
  // branch, since Turing Machine is next on this project's roadmap
  // (docs/decisions.md). Real JFLAP's own "New" menu order: Finite
  // Automaton, Mealy, Moore, Pushdown.
  const modes = {
    finite: { label: "Autómata Finito", appBody, toolbar: faToolbar },
    mealy: { label: "Máquina de Mealy", appBody: mealyAppBody, toolbar: mealyToolbar },
    moore: { label: "Máquina de Moore", appBody: mooreAppBody, toolbar: mooreToolbar },
    pda: { label: "Autómata de Pila", appBody: pdaAppBody, toolbar: pdaToolbar },
  };

  const modeSelect = new EditorModeSelect(toolbarHost, ctx, {
    modes: Object.entries(modes).map(([value, m]) => ({ value, label: m.label })),
    onSwitchMode: (mode) => switchMode(mode),
  });

  // Constructed last so its `when(ctx)` guards evaluate against the fully
  // wired context (real viewport/testing hooks, not their startup no-ops).
  // FA-scoped (Archivo/Editar/Ver/Convertir/Test) — none of that applies to
  // a Mealy or Moore document, so it hides for every mode but "finite".
  const menuBar = new MenuBar(menuBarHost, ctx);

  let currentAppBody = appBody;

  /** @param {string} mode one of `modes`' keys */
  function switchMode(mode) {
    for (const [id, entry] of Object.entries(modes)) {
      entry.toolbar.root.hidden = id !== mode;
    }
    const nextAppBody = modes[mode].appBody;
    if (nextAppBody !== currentAppBody) {
      currentAppBody.replaceWith(nextAppBody);
      currentAppBody = nextAppBody;
    }
    menuBar.root.hidden = mode !== "finite";
    modeSelect.setMode(mode);
  }
  mealyToolbar.root.hidden = true;
  mooreToolbar.root.hidden = true;
  pdaToolbar.root.hidden = true;

  await Promise.all([docStore.load(), mealyDocStore.load(), mooreDocStore.load(), pdaDocStore.load()]);
}

main();
