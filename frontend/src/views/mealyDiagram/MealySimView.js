// Minimal "run an input, see the output" panel for Mealy — the transducer
// equivalent of `TestingView`'s Cadena tab, but simpler on purpose for v1:
// a Mealy machine either finishes (with an output string) or gets stuck at
// a specific position (no matching transition, or an ambiguous one) —
// there's no accept/reject verdict or step-by-step trace to visualize the
// way FA's simulation has. A batch tab and richer trace view are the
// natural next addition, not built here.

export class MealySimView {
  /**
   * @param {HTMLElement} container
   * @param {(input: string[]) => Promise<object>} runSim `ctx.mealySim`-shaped: resolves a MealySimDto.
   */
  constructor(container, runSim) {
    this.container = container;
    this.runSim = runSim;
    this._build();
  }

  _build() {
    this.root = document.createElement("div");
    this.root.className = "mealy-sim-view testing-single";

    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = "Entrada (símbolos separados por espacio)";

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "mealy-sim-input string-input";
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
    this.output.className = "mealy-sim-output";

    this.root.append(label, this.input, calcRow, this.output);
    this.container.appendChild(this.root);
  }

  async _onRun() {
    const input = this.input.value.split(/\s+/).filter(Boolean);
    const outcome = await this.runSim(input);
    this.output.textContent = formatOutcome(outcome);
    this.output.classList.toggle("mealy-sim-error", outcome.outcome !== "Completed");
  }
}

function formatOutcome(outcome) {
  switch (outcome.outcome) {
    case "Completed":
      return outcome.outputs.length ? `Salida: ${outcome.outputs.join(" ")}` : "Salida: (cadena vacía)";
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
