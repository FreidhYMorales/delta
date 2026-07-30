// L2: testing drawer (task 7.6, spec `fa-simulation`, design D6's
// progressive-disclosure "L2 testing drawer (single trace + batch), bottom"
// and the kflap-v0.1 UX reference (README "Verificación de cadenas"):
// single-string verdict + step-by-step trace with `◀ ▶` highlighting the
// active states on the diagram, plus a batch results table. Collapsed by
// default like the L1 dock (`<details>`, no `open`), and — per design D6
// ("nothing can exist as a toolbar-only tool") — only reachable through the
// command registry's `test.singleTrace`/`test.batch` actions, which merely
// open this drawer and focus the relevant input; running a trace itself is
// still a user click, same as every other view in this app.

import { formatStepStates, isTruncated, parseBatchLines, tokenizeInput, verdictLabel } from "./testingLogic.js";

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
    this._stepIndex = 0;

    this._build();
    docStore.subscribe(() => this._renderBatchRows());
    this._render();

    /** Exposed for `commands/registry.js`'s `test.singleTrace`/`test.batch`
     * actions (same "post-construction handoff" convention as
     * `ctx.viewport = diagramView.viewport` in `main.js`). */
    this.controls = {
      openSingle: () => {
        this.details.open = true;
        this.singleInput.focus();
      },
      openBatch: () => {
        this.details.open = true;
        this.batchTextarea.focus();
      },
    };
  }

  _build() {
    this.details = document.createElement("details");
    this.details.className = "testing-view";
    const summary = document.createElement("summary");
    summary.textContent = "Testing";
    this.details.addEventListener("toggle", () => {
      if (!this.details.open) this._clearActiveStates();
    });

    // --- Single-string trace -------------------------------------------
    const singleSection = document.createElement("div");
    singleSection.className = "testing-single";

    this.singleInput = document.createElement("input");
    this.singleInput.type = "text";
    this.singleInput.className = "testing-single-input";
    this.singleInput.placeholder = "Input string (blank = ε)";

    this.runButton = document.createElement("button");
    this.runButton.type = "button";
    this.runButton.textContent = "Run";
    this.runButton.addEventListener("click", () => {
      this._lastRunPromise = this._runSingle();
    });

    this.verdict = document.createElement("span");
    this.verdict.className = "testing-verdict";

    const stepNav = document.createElement("div");
    stepNav.className = "testing-step-nav";
    this.prevStepButton = document.createElement("button");
    this.prevStepButton.type = "button";
    this.prevStepButton.className = "testing-step-prev";
    this.prevStepButton.textContent = "◀";
    this.prevStepButton.addEventListener("click", () => this._stepBy(-1));
    this.stepLabel = document.createElement("span");
    this.stepLabel.className = "testing-step-label";
    this.nextStepButton = document.createElement("button");
    this.nextStepButton.type = "button";
    this.nextStepButton.className = "testing-step-next";
    this.nextStepButton.textContent = "▶";
    this.nextStepButton.addEventListener("click", () => this._stepBy(1));
    stepNav.append(this.prevStepButton, this.stepLabel, this.nextStepButton);

    this.activeStatesLabel = document.createElement("div");
    this.activeStatesLabel.className = "testing-active-states";

    singleSection.append(this.singleInput, this.runButton, this.verdict, stepNav, this.activeStatesLabel);

    // --- Batch ------------------------------------------------------------
    const batchSection = document.createElement("div");
    batchSection.className = "testing-batch";

    this.batchTextarea = document.createElement("textarea");
    this.batchTextarea.className = "testing-batch-input";
    this.batchTextarea.placeholder = "One string per line";

    this.batchRunButton = document.createElement("button");
    this.batchRunButton.type = "button";
    this.batchRunButton.textContent = "Run batch";
    this.batchRunButton.addEventListener("click", () => {
      this._lastBatchPromise = this._runBatch();
    });

    this.batchTable = document.createElement("table");
    this.batchTable.className = "testing-batch-table";
    this.batchTbody = document.createElement("tbody");
    this.batchTable.appendChild(this.batchTbody);

    batchSection.append(this.batchTextarea, this.batchRunButton, this.batchTable);

    this.details.append(summary, singleSection, batchSection);
    this.container.appendChild(this.details);
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
    this._stepIndex = 0;
    this._renderSingle();
  }

  async _runBatch() {
    const lines = parseBatchLines(this.batchTextarea.value);
    const words = lines.map((line) => tokenizeInput(line, this._alphabet()));
    const traces = await this.ctx.simBatch(words);
    this._batchResults = lines.map((line, i) => ({ input: line, outcome: traces[i]?.outcome ?? "Rejected" }));
    this._renderBatchRows();
  }

  _stepBy(delta) {
    if (!this._trace || !this._trace.steps.length) return;
    const max = this._trace.steps.length - 1;
    this._stepIndex = Math.min(max, Math.max(0, this._stepIndex + delta));
    this._renderSingle();
  }

  _clearActiveStates() {
    this.ctx.setActiveStates([]);
  }

  _render() {
    this._renderSingle();
    this._renderBatchRows();
  }

  _renderSingle() {
    if (!this._trace) {
      this.verdict.textContent = "";
      this.stepLabel.textContent = "";
      this.activeStatesLabel.textContent = "";
      this.prevStepButton.disabled = true;
      this.nextStepButton.disabled = true;
      return;
    }
    const { outcome, steps } = this._trace;
    this.verdict.textContent = verdictLabel(outcome);
    this.verdict.classList.toggle("testing-verdict-accepted", outcome === "Accepted");
    this.verdict.classList.toggle("testing-verdict-rejected", outcome === "Rejected" || outcome === "Stuck");
    this.verdict.classList.toggle("testing-verdict-truncated", isTruncated(outcome));

    const total = steps.length;
    this.stepLabel.textContent = total ? `Step ${this._stepIndex + 1}/${total}` : "No steps";
    this.prevStepButton.disabled = this._stepIndex <= 0;
    this.nextStepButton.disabled = total === 0 || this._stepIndex >= total - 1;

    const activeIds = steps[this._stepIndex] ?? [];
    this.activeStatesLabel.textContent = activeIds.length
      ? `Active: ${formatStepStates(activeIds, this._labelOf())}`
      : "Active: —";
    this.ctx.setActiveStates(activeIds);
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
