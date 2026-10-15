// "AFN → AFD" tab: the NFA-ε to DFA conversion shown step by step, the way
// it is worked by hand — ε-closures, the NFA-ε transition table, and the
// transition table without ε (subset construction). Read-only and derived
// from the current automaton on every change (`afnToAfdLogic.js`). Each
// table has its own copy button (tab-separated, so it pastes straight into
// a spreadsheet), and the resulting DFA can be created in a new tab without
// touching this one.

import { createCopyTableButton } from "../../ui/copyTable.js";
import { buildConversion } from "./afnToAfdLogic.js";

const STEPS = [
  { key: "closures", title: "Paso 1: clausuras ε" },
  { key: "nfaTable", title: "Paso 2: tabla de transiciones del AFN-ε" },
  { key: "dfaTable", title: "Paso 3: tabla de transiciones sin ε" },
];

export class AfnToAfdView {
  /**
   * @param {HTMLElement} container
   * @param {import('../../store/DocStore.js').DocStore} docStore
   * @param {{createDfaTab: (model: object) => Promise<void>}} ctx
   */
  constructor(container, docStore, ctx) {
    this.docStore = docStore;
    this.ctx = ctx;
    this._dfa = null;
    this._build(container);
    docStore.subscribe(() => this._render());
    this._render();
  }

  _build(container) {
    this.root = document.createElement("div");
    this.root.className = "table-view afn-afd-view";

    this.tables = new Map();
    for (const step of STEPS) {
      const section = document.createElement("section");
      section.className = "afn-afd-step";
      const header = document.createElement("div");
      header.className = "afn-afd-step-header";
      const title = document.createElement("h3");
      title.textContent = step.title;
      const table = document.createElement("table");
      header.append(title, createCopyTableButton(() => table));
      section.append(header, table);
      this.root.appendChild(section);
      this.tables.set(step.key, table);
    }

    this.note = document.createElement("p");
    this.note.className = "afn-afd-note";

    this.createButton = document.createElement("button");
    this.createButton.type = "button";
    this.createButton.className = "btn-secondary afn-afd-create";
    this.createButton.textContent = "Crear AFD en nueva pestaña";
    this.createButton.addEventListener("click", () => {
      if (this._dfa) this._lastCreatePromise = this.ctx.createDfaTab(this._dfa);
    });

    this.root.append(this.note, this.createButton);
    container.appendChild(this.root);
  }

  _render() {
    const conversion = buildConversion(this.docStore.getStates(), this.docStore.getEdges());
    for (const step of STEPS) fillTable(this.tables.get(step.key), conversion[step.key]);
    this._dfa = conversion.dfa;
    this.createButton.disabled = !this._dfa;
    this.note.textContent = this._dfa
      ? "El estado inicial es el mismo; los estados de aceptación son los subconjuntos que contienen un estado de aceptación original (*)."
      : "Marcá un estado inicial para construir el paso 3 y el AFD.";
  }
}

/** @param {HTMLTableElement} table @param {{headers:string[], rows:string[][]}} data */
function fillTable(table, { headers, rows }) {
  const thead = document.createElement("thead");
  const headRow = thead.insertRow();
  for (const text of headers) {
    const th = document.createElement("th");
    th.textContent = text;
    headRow.appendChild(th);
  }
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = tbody.insertRow();
    row.forEach((text, i) => {
      const cell = document.createElement(i === 0 ? "th" : "td");
      cell.textContent = text;
      tr.appendChild(cell);
    });
  }
  table.replaceChildren(thead, tbody);
}
