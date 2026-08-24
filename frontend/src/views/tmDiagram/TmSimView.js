// "Run an input, see every live branch's tapes per step" panel for TM —
// same role as `PdaSimView.js`, but genuinely different in shape, all
// traceable to `engine::tm`:
//  - Multiple tapes, not one stack: renders `Math.max(1, effective tape
//    count)` separate input fields, one per tape ("Cinta 1", "Cinta 2", ...)
//    instead of PDA's single input field. `effectiveTapeCount` (`tmLogic.js`)
//    is used so the field count stays right whether `TmDoc::tape_count` is
//    already locked or the document has no transitions yet (falls back to
//    `ctx.tapeCountChoice`) — this is why, unlike `PdaSimView`'s plain
//    `(container, runSim)` constructor, this view also needs `docStore`/
//    `ctx` themselves, not just the sim function, and re-renders its input
//    fields whenever either changes (tape count can go from "not yet
//    locked" to "locked" the moment the first transition is added).
//  - "Aceptar por" offers "Estado final"/"Detención" (TM's real two modes —
//    no PDA-style "Pila vacía", a TM has no stack; "Detención" = no further
//    move available, `AcceptMode::Halting`).
//  - Still nondeterministic exactly like PDA's (`run_tm` explores every live
//    configuration, same `run_bounded`-based engine) — shows the full set of
//    live `(state, tapes)` configurations at each step.
//
// Kept deliberately simple for v1, same "no accept/reject verdict beyond a
// plain outcome label, no per-config diagram highlighting" scope PDA's own
// `PdaSimView.js` already documents.

import { effectiveTapeCount, formatTapeCells } from "./tmLogic.js";

const OUTCOME_LABELS = {
  Accepted: "Aceptado",
  Rejected: "Rechazado",
  Stuck: "Atascado (sin transición aplicable)",
  TruncatedSteps: "Truncado (demasiados pasos)",
  TruncatedConfigs: "Truncado (demasiadas configuraciones)",
};

export class TmSimView {
  /**
   * @param {HTMLElement} container
   * @param {import('../../store/TmDocStore.js').TmDocStore} docStore
   * @param {import('../../commands/TmContext.js').TmContext} ctx
   * @param {(inputs: string[][], acceptBy: "final"|"halting") => Promise<object>} runSim
   *   `ctx.tmSim`-shaped: resolves a TmTraceDto ({outcome, steps: Array<Array<{state,tapes}>>}).
   */
  constructor(container, docStore, ctx, runSim) {
    this.container = container;
    this.docStore = docStore;
    this.ctx = ctx;
    this.runSim = runSim;
    this._lastCount = null;
    this.tapeInputs = [];
    this._build();
    this._renderInputs();
    docStore.subscribe(() => this._renderInputs());
    ctx.subscribe(() => this._renderInputs());
  }

  _build() {
    this.root = document.createElement("div");
    this.root.className = "tm-sim-view testing-single";

    this.tapeInputsContainer = document.createElement("div");
    this.tapeInputsContainer.className = "tm-sim-tape-inputs";

    const acceptLabel = document.createElement("label");
    acceptLabel.className = "field-label";
    acceptLabel.textContent = "Aceptar por";

    this.acceptBySelect = document.createElement("select");
    this.acceptBySelect.className = "tm-sim-accept-by";
    for (const [value, text] of [
      ["final", "Estado final"],
      ["halting", "Detención"],
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      this.acceptBySelect.appendChild(option);
    }

    this.runButton = document.createElement("button");
    this.runButton.type = "button";
    this.runButton.className = "btn-primary";
    this.runButton.textContent = "Simular →";
    this.runButton.addEventListener("click", () => {
      this._lastRunPromise = this._onRun();
    });
    const calcRow = document.createElement("div");
    calcRow.className = "calc-row";
    calcRow.appendChild(this.runButton);

    this.output = document.createElement("div");
    this.output.className = "tm-sim-output";

    this.root.append(this.tapeInputsContainer, acceptLabel, this.acceptBySelect, calcRow, this.output);
    this.container.appendChild(this.root);
  }

  /** Rebuilds the per-tape input fields when the effective tape count
   * changes (e.g. the toolbar's tape-count choice changes pre-lock, or the
   * document's first-ever transition locks `TmDoc::tape_count`) — preserves
   * already-typed values for tape indices that still exist, same "don't
   * throw away user input for no reason" courtesy as everywhere else in
   * this app that re-renders on doc changes. */
  _renderInputs() {
    const count = Math.max(1, effectiveTapeCount(this.docStore, this.ctx));
    if (count === this._lastCount) return;
    this._lastCount = count;

    const oldValues = this.tapeInputs.map((input) => input.value);
    this.tapeInputsContainer.textContent = "";
    this.tapeInputs = [];
    for (let i = 0; i < count; i++) {
      const label = document.createElement("label");
      label.className = "field-label";
      label.textContent = `Cinta ${i + 1}`;

      const input = document.createElement("input");
      input.type = "text";
      input.className = "tm-sim-input string-input";
      input.placeholder = "p.ej. a a b b";
      if (oldValues[i]) input.value = oldValues[i];

      this.tapeInputsContainer.append(label, input);
      this.tapeInputs.push(input);
    }
  }

  async _onRun() {
    const inputs = this.tapeInputs.map((input) => input.value.split(/\s+/).filter(Boolean));
    const outcome = await this.runSim(inputs, this.acceptBySelect.value);
    this._renderOutcome(outcome);
  }

  _renderOutcome(outcome) {
    this.output.textContent = "";
    this.output.classList.toggle("tm-sim-error", outcome.outcome !== "Accepted");

    const verdict = document.createElement("div");
    verdict.className = "tm-sim-verdict";
    verdict.textContent = `Resultado: ${OUTCOME_LABELS[outcome.outcome] ?? outcome.outcome}`;
    this.output.appendChild(verdict);

    const list = document.createElement("ol");
    list.className = "tm-sim-steps";
    for (const [i, configs] of outcome.steps.entries()) {
      const item = document.createElement("li");
      item.textContent =
        `Paso ${i}: ` +
        configs
          .map((c) => `#${c.state} ` + c.tapes.map((t, ti) => `T${ti}:${formatTapeCells(t)}`).join(" "))
          .join(" | ");
      list.appendChild(item);
    }
    this.output.appendChild(list);
  }
}
