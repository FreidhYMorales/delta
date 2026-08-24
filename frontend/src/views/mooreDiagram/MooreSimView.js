// Minimal "run an input, see the output" panel for Moore — same role as
// `MealySimView.js`, the transducer equivalent of `TestingView`'s Cadena
// tab, simpler than FA's on purpose for v1 (no accept/reject verdict or
// step-by-step trace view).
//
// Differs from `MealySimView` in exactly the way `MooreOutcome` differs
// from `MealyOutcome`: `Completed.outputs` has length input.length+1 (the
// initial state's output is emitted before consuming anything — see
// engine::moore's doc comment / docs/decisions.md), so the display joins
// each output with the input symbol that was consumed to reach it, instead
// of a flat space-joined list.

export class MooreSimView {
  /**
   * @param {HTMLElement} container
   * @param {(input: string[]) => Promise<object>} runSim `ctx.mooreSim`-shaped: resolves a MooreSimDto.
   */
  constructor(container, runSim) {
    this.container = container;
    this.runSim = runSim;
    this._build();
  }

  _build() {
    this.root = document.createElement("div");
    this.root.className = "moore-sim-view testing-single";

    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = "Entrada (símbolos separados por espacio)";

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "moore-sim-input string-input";
    this.input.placeholder = "p.ej. 1 0 1 1";

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
    this.output.className = "moore-sim-output";

    this.root.append(label, this.input, calcRow, this.output);
    this.container.appendChild(this.root);
  }

  async _onRun() {
    const input = this.input.value.split(/\s+/).filter(Boolean);
    const outcome = await this.runSim(input);
    this.output.textContent = formatOutcome(outcome, input);
    this.output.classList.toggle("moore-sim-error", outcome.outcome !== "Completed");
  }
}

/**
 * @param {object} outcome MooreSimDto
 * @param {string[]} input the symbols that were run, to label the arrows
 *   between consecutive outputs (`outputs[i+1]` is reached by consuming
 *   `input[i]`).
 */
function formatOutcome(outcome, input) {
  switch (outcome.outcome) {
    case "Completed": {
      const [first, ...rest] = outcome.outputs;
      const steps = rest.map((out, i) => `--[${input[i]}]--> ${out}`).join(" ");
      return `Salida: ${first}` + (steps ? ` ${steps}` : "");
    }
    case "NoInitialState":
      return "Sin estado inicial.";
    case "NoTransition":
      return `Sin transición en la posición ${outcome.at}.`;
    case "Ambiguous":
      return `Ambiguo (no determinista) en la posición ${outcome.at}.`;
    default:
      return "";
  }
}
