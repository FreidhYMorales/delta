// "Run an input, see every live branch's stack per step" panel for PDA —
// same role as `MooreSimView.js`/`MealySimView.js`, but genuinely different
// in two ways traceable straight to `engine::pda`:
//  - PDA simulation is nondeterministic — `run_pda` explores every live
//    configuration breadth-first (`engine::pda`'s doc comment), so this
//    shows the FULL set of live `(state, stack)` configurations at each
//    step, not one deterministic output sequence like Moore/Mealy.
//  - Needs an "Aceptar por" selector (Estado final / Pila vacía) before
//    running — the accept mode is a per-run choice, never document state
//    (see docs/decisions.md, the PDA backend entry; real JFLAP prompts for
//    this via a dialog on every run, same idea here).
//
// Kept deliberately simple for v1, same "no accept/reject verdict beyond a
// plain outcome label, no per-config diagram highlighting" scope Moore/Mealy
// started with — a step-by-step visual trace can come later if needed.

const OUTCOME_LABELS = {
  Accepted: "Aceptado",
  Rejected: "Rechazado",
  Stuck: "Atascado (sin transición aplicable)",
  TruncatedSteps: "Truncado (demasiados pasos)",
  TruncatedConfigs: "Truncado (demasiadas configuraciones)",
};

export class PdaSimView {
  /**
   * @param {HTMLElement} container
   * @param {(input: string[], acceptBy: "final"|"empty") => Promise<object>} runSim
   *   `ctx.pdaSim`-shaped: resolves a PdaTraceDto ({outcome, steps: Array<Array<{state,stack}>>}).
   */
  constructor(container, runSim) {
    this.container = container;
    this.runSim = runSim;
    this._build();
  }

  _build() {
    this.root = document.createElement("div");
    this.root.className = "pda-sim-view testing-single";

    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = "Entrada (símbolos separados por espacio)";

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "pda-sim-input string-input";
    this.input.placeholder = "p.ej. a a b b";

    const acceptLabel = document.createElement("label");
    acceptLabel.className = "field-label";
    acceptLabel.textContent = "Aceptar por";

    this.acceptBySelect = document.createElement("select");
    this.acceptBySelect.className = "pda-sim-accept-by";
    for (const [value, text] of [
      ["final", "Estado final"],
      ["empty", "Pila vacía"],
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
    this.output.className = "pda-sim-output";

    this.root.append(label, this.input, acceptLabel, this.acceptBySelect, calcRow, this.output);
    this.container.appendChild(this.root);
  }

  async _onRun() {
    const input = this.input.value.split(/\s+/).filter(Boolean);
    const outcome = await this.runSim(input, this.acceptBySelect.value);
    this._renderOutcome(outcome);
  }

  _renderOutcome(outcome) {
    this.output.textContent = "";
    this.output.classList.toggle("pda-sim-error", outcome.outcome !== "Accepted");

    const verdict = document.createElement("div");
    verdict.className = "pda-sim-verdict";
    verdict.textContent = `Resultado: ${OUTCOME_LABELS[outcome.outcome] ?? outcome.outcome}`;
    this.output.appendChild(verdict);

    const list = document.createElement("ol");
    list.className = "pda-sim-steps";
    for (const [i, configs] of outcome.steps.entries()) {
      const item = document.createElement("li");
      item.textContent = `Paso ${i}: ` + configs.map((c) => `#${c.state} [${c.stack.join(" ") || "—"}]`).join(" | ");
      list.appendChild(item);
    }
    this.output.appendChild(list);
  }
}
