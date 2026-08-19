// L2: testing panel (task 7.6, spec `fa-simulation`): single-string verdict
// + the full trace rendered as connected chips (wireframe parity — the
// previous `◀ ▶` step-nav + live diagram highlighting was dropped in favor
// of showing the whole trace at once, docs/decisions.md), plus a batch
// results table. Lives in the right column's lower tab group (main.js),
// split into three tabs matching the layout plan agreed with the user:
// "Cadena" (single-string input), "Lote" (batch input), "Resultados"
// (verdict/trace/batch table) — clicking Calcular jumps straight to
// Resultados, so the answer is always where you land. Only reachable
// through the command registry's `test.singleTrace`/`test.batch` actions
// (design D6: "nothing can exist as a toolbar-only tool"), which select the
// relevant tab and focus its input; running a trace itself is still a user
// click, same as every other view in this app.

import { createTabs } from "../../ui/tabs.js";
import { formatStepStates, isTruncated, parseBatchLines, tokenizeInput, verdictLabel } from "./testingLogic.js";

/** @param {string} outcome one of `TraceDto.outcome`'s Rust-side values */
function verdictVariant(outcome) {
  if (outcome === "Accepted") return "accepted";
  if (isTruncated(outcome)) return "truncated";
  return "rejected";
}

export class TestingView {
  /**
   * @param {HTMLElement} container
   * @param {import('../../store/DocStore.js').DocStore} docStore
   * @param {import('../../commands/context.js').ViewContext} ctx
   */
  constructor(container, docStore, ctx) {
    this.container = container;
    this.docStore = docStore;
    this.ctx = ctx;
    /** Current single-string trace result, or `null`. `{outcome, steps}` —
     * shape mirrors `TraceDto` (`src-tauri/src/commands/sim.rs`). */
    this._trace = null;
    /** Which of the two Resultados sub-views to show: `"single"`, `"batch"`,
     * or `null` before either has run once. */
    this._resultMode = null;

    this._build();
    docStore.subscribe(() => this._renderBatchRows());
    this._render();

    /** Exposed for `commands/registry.js`'s `test.singleTrace`/`test.batch`
     * actions (same "post-construction handoff" convention as
     * `ctx.viewport = diagramView.viewport` in `main.js`). */
    this.controls = {
      openSingle: () => {
        this._selectTab("cadena");
        this.singleInput.focus();
      },
      openBatch: () => {
        this._selectTab("lote");
        this.batchTextarea.focus();
      },
    };
  }

  _build() {
    this.root = document.createElement("div");
    this.root.className = "testing-view";

    const { panels, select } = createTabs(this.root, [
      { id: "cadena", label: "Cadena" },
      { id: "lote", label: "Lote" },
      { id: "resultados", label: "Resultados" },
    ]);
    this._selectTab = select;

    // --- Cadena tab: single-string input, runs on Calcular -----------------
    const cadenaSection = document.createElement("div");
    cadenaSection.className = "testing-single";

    const singleLabel = document.createElement("label");
    singleLabel.className = "field-label";
    singleLabel.textContent = "Cadena a verificar";

    this.singleInput = document.createElement("input");
    this.singleInput.type = "text";
    this.singleInput.className = "testing-single-input string-input";
    this.singleInput.placeholder = "Input string (blank = ε)";

    this.runButton = document.createElement("button");
    this.runButton.type = "button";
    this.runButton.className = "btn-primary";
    this.runButton.textContent = "Calcular →";
    this.runButton.addEventListener("click", () => {
      this._lastRunPromise = this._runSingle();
    });
    const singleCalcRow = document.createElement("div");
    singleCalcRow.className = "calc-row";
    singleCalcRow.appendChild(this.runButton);

    cadenaSection.append(singleLabel, this.singleInput, singleCalcRow);
    panels.get("cadena").appendChild(cadenaSection);

    // --- Lote tab: batch textarea, runs on Calcular lote --------------------
    const loteSection = document.createElement("div");
    loteSection.className = "testing-batch";

    const batchLabel = document.createElement("label");
    batchLabel.className = "field-label";
    batchLabel.textContent = "Una cadena por línea";

    this.batchTextarea = document.createElement("textarea");
    this.batchTextarea.className = "testing-batch-input string-input";
    this.batchTextarea.placeholder = "One string per line";

    this.batchRunButton = document.createElement("button");
    this.batchRunButton.type = "button";
    this.batchRunButton.className = "btn-primary";
    this.batchRunButton.textContent = "Calcular lote →";
    this.batchRunButton.addEventListener("click", () => {
      this._lastBatchPromise = this._runBatch();
    });
    const batchCalcRow = document.createElement("div");
    batchCalcRow.className = "calc-row";
    batchCalcRow.appendChild(this.batchRunButton);

    loteSection.append(batchLabel, this.batchTextarea, batchCalcRow);
    panels.get("lote").appendChild(loteSection);

    // --- Resultados tab: verdict pill + full trace as connected chips
    // (wireframe parity, docs/decisions.md: replaces the previous ◀/▶
    // step-nav + live canvas highlighting — explicit user call, since the
    // wireframe shows the whole trace at once) + batch table -------------
    const resultadosSection = document.createElement("div");
    resultadosSection.className = "testing-results";

    this.emptyHint = document.createElement("p");
    this.emptyHint.className = "empty-hint";
    this.emptyHint.textContent = 'Todavía no calculaste nada — probá "Calcular" en la pestaña Cadena.';

    this.verdict = document.createElement("span");
    this.verdict.className = "testing-verdict verdict";

    this.traceRow = document.createElement("div");
    this.traceRow.className = "trace-row";

    this.batchTable = document.createElement("table");
    this.batchTable.className = "testing-batch-table";
    this.batchTbody = document.createElement("tbody");
    this.batchTable.appendChild(this.batchTbody);

    resultadosSection.append(this.emptyHint, this.verdict, this.traceRow, this.batchTable);
    panels.get("resultados").appendChild(resultadosSection);

    this.container.appendChild(this.root);
  }

  _alphabet() {
    return this.docStore.derived.alphabet ?? [];
  }

  _labelOf() {
    return new Map(this.docStore.getStates().map((s) => [s.id, s.label]));
  }

  async _runSingle() {
    const word = tokenizeInput(this.singleInput.value, this._alphabet());
    this._trace = await this.ctx.simTrace(word);
    this._resultMode = "single";
    this._renderResults();
    this._selectTab("resultados");
  }

  async _runBatch() {
    const lines = parseBatchLines(this.batchTextarea.value);
    const words = lines.map((line) => tokenizeInput(line, this._alphabet()));
    const traces = await this.ctx.simBatch(words);
    this._batchResults = lines.map((line, i) => ({ input: line, outcome: traces[i]?.outcome ?? "Rejected" }));
    this._resultMode = "batch";
    this._renderResults();
    this._selectTab("resultados");
  }

  _render() {
    this._renderResults();
  }

  /** Resultados shows exactly one of: the empty hint, the single-trace
   * verdict+trace-row, or the batch table — never a leftover from whichever
   * ran previously (bug: after a batch run, the single-trace empty hint
   * stayed visible alongside the batch table). `_resultMode` tracks which
   * of the two was last run; `null` until either has run once. */
  _renderResults() {
    this._renderSingle();
    this._renderBatchRows();
    this.emptyHint.hidden = this._resultMode != null;
    this.verdict.hidden = this._resultMode !== "single";
    this.traceRow.hidden = this._resultMode !== "single";
    this.batchTable.hidden = this._resultMode !== "batch";
  }

  _renderSingle() {
    if (!this._trace) {
      this.verdict.textContent = "";
      this.verdict.className = "testing-verdict verdict";
      this.traceRow.innerHTML = "";
      return;
    }
    const { outcome, steps } = this._trace;
    this.verdict.textContent = verdictLabel(outcome);
    const variant = verdictVariant(outcome);
    this.verdict.className = "testing-verdict verdict";
    this.verdict.classList.add(variant, `testing-verdict-${variant}`);

    const labelOf = this._labelOf();
    this.traceRow.innerHTML = "";
    steps.forEach((stepIds, i) => {
      const chip = document.createElement("span");
      chip.className = "trace-step";
      if (i === steps.length - 1) chip.classList.add("hit");
      chip.textContent = stepIds.length ? formatStepStates(stepIds, labelOf) : "—";
      this.traceRow.appendChild(chip);
      if (i < steps.length - 1) {
        const arrow = document.createElement("span");
        arrow.className = "trace-arrow";
        arrow.textContent = "→";
        this.traceRow.appendChild(arrow);
      }
    });
  }

  _renderBatchRows() {
    this.batchTbody.innerHTML = "";
    for (const { input, outcome } of this._batchResults ?? []) {
      const tr = document.createElement("tr");
      const inputCell = document.createElement("td");
      inputCell.textContent = input === "" ? "ε" : input;
      const verdictCell = document.createElement("td");
      verdictCell.textContent = verdictLabel(outcome);
      verdictCell.className =
        outcome === "Accepted" ? "testing-verdict-accepted" : "testing-verdict-rejected";
      tr.append(inputCell, verdictCell);
      this.batchTbody.appendChild(tr);
    }
  }
}
