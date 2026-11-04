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

import { tokenizeInput } from "../testing/testingLogic.js";

const OUTCOME_LABELS = {
  Accepted: "Aceptado",
  Rejected: "Rechazado",
  Stuck: "Atascado (sin transición aplicable)",
  TruncatedSteps: "Truncado (demasiados pasos)",
  TruncatedConfigs: "Truncado (demasiadas configuraciones)",
};

function verdictVariant(outcome) {
  if (outcome === "Accepted") return "accepted";
  if (outcome === "TruncatedSteps" || outcome === "TruncatedConfigs") return "truncated";
  return "rejected";
}

const STEP_TABLE_COLUMNS = ["Paso", "Estado Actual", "Cadena Restante", "Cima de Pila", "Siguiente Estado", "Nueva Pila"];

/** The workbook writes symbols together, and nothing left as ε. */
function joined(symbols) {
  return symbols.join("") || "ε";
}

function appendRow(section, tag, cells) {
  const row = section.insertRow();
  for (const text of cells) {
    const cell = document.createElement(tag);
    cell.textContent = text;
    row.appendChild(cell);
  }
}

function buildStepTable(rows) {
  const table = document.createElement("table");
  table.className = "pda-step-table testing-batch-table";
  appendRow(table.createTHead(), "th", STEP_TABLE_COLUMNS);
  const body = table.createTBody();
  rows.forEach((row, i) => {
    appendRow(body, "td", [
      String(i + 1),
      row.state,
      joined(row.remaining),
      joined(row.stack),
      row.next_state ?? "BLOQUEO",
      joined(row.next_stack),
    ]);
  });
  return table;
}

export class PdaSimView {
  /**
   * @param {HTMLElement} container
   * @param {(input: string[], acceptBy: "final"|"empty") => Promise<object>} runSim
   *   `ctx.pdaSim`-shaped: resolves a PdaTraceDto ({outcome, steps: Array<Array<{state,stack}>>}).
   * @param {import('../../store/PdaDocStore.js').PdaDocStore} [docStore]
   *   source and target of the initial stack symbol field; the field is left
   *   out without it.
   */
  constructor(container, runSim, docStore = null) {
    this.container = container;
    this.runSim = runSim;
    this.docStore = docStore;
    this._build();
    if (docStore) {
      docStore.subscribe(() => this._renderInitialStack());
      this._renderInitialStack();
    }
  }

  _renderInitialStack() {
    this.initialStackInput.value = this.docStore.derived?.initial_stack_symbol ?? "Z";
  }

  _buildInitialStackField() {
    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = "Símbolo inicial de pila";

    this.initialStackInput = document.createElement("input");
    this.initialStackInput.type = "text";
    this.initialStackInput.className = "pda-sim-initial-stack string-input";
    this.initialStackInput.addEventListener("change", () => {
      this.docStore.apply([{ op: "SetInitialStackSymbol", symbol: this.initialStackInput.value }]);
    });

    this.root.append(label, this.initialStackInput);
  }

  _build() {
    this.root = document.createElement("div");
    this.root.className = "pda-sim-view testing-single";
    if (this.docStore) this._buildInitialStackField();

    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = "Entrada";

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "pda-sim-input string-input";
    this.input.placeholder = "p.ej. aabb";

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
    const alphabet = this.docStore?.derived?.input_alphabet ?? [];
    const input = this.input.value
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((chunk) => tokenizeInput(chunk, alphabet));
    const outcome = await this.runSim(input, this.acceptBySelect.value);
    this._renderOutcome(outcome);
  }

  _renderOutcome(outcome) {
    this.output.textContent = "";
    this.output.classList.toggle("pda-sim-error", outcome.outcome !== "Accepted");

    const verdict = document.createElement("div");
    verdict.className = `pda-sim-verdict ${verdictVariant(outcome.outcome)}`;
    verdict.textContent = `Resultado: ${OUTCOME_LABELS[outcome.outcome] ?? outcome.outcome}`;
    this.output.appendChild(verdict);
    if (outcome.table?.length) this.output.appendChild(buildStepTable(outcome.table));

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
