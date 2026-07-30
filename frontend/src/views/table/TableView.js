// L1: state-table-view (task 7.5), collapsed by default (`<details>`, no
// `open` attribute), kept in sync with the diagram purely by re-rendering
// on every `DocStore` change (design D6: "Single `DocStore` ... feeds all
// views"). Column format and row markers mirror kflap-v0.1's table
// (README): `→` initial, `*` accepting, one `Σ` column per symbol plus a
// fixed `ε` column, cells are comma-separated destination labels.

import { EPSILON, cellValue, computeCellUpdateOps, parseCellTargets, rowLabel } from "./tableLogic.js";

export class TableView {
  /**
   * @param {HTMLElement} container
   * @param {import('../../store/DocStore.js').DocStore} docStore
   */
  constructor(container, docStore) {
    this.container = container;
    this.docStore = docStore;
    this._build();
    docStore.subscribe(() => this._render());
    this._render();
  }

  _build() {
    this.details = document.createElement("details");
    this.details.className = "table-view";
    const summary = document.createElement("summary");
    summary.textContent = "State Table";
    this.table = document.createElement("table");
    this.thead = document.createElement("thead");
    this.tbody = document.createElement("tbody");
    this.table.append(this.thead, this.tbody);
    this.details.append(summary, this.table);
    this.container.appendChild(this.details);
  }

  _columns() {
    return [...this.docStore.derived.alphabet, EPSILON];
  }

  _render() {
    const states = this.docStore.getStates();
    const edges = this.docStore.getEdges();
    const labelOf = new Map(states.map((s) => [s.id, s.label]));
    const columns = this._columns();

    this.thead.innerHTML = "";
    const headRow = document.createElement("tr");
    headRow.appendChild(document.createElement("th"));
    for (const symbol of columns) {
      const th = document.createElement("th");
      th.textContent = symbol;
      headRow.appendChild(th);
    }
    this.thead.appendChild(headRow);

    this.tbody.innerHTML = "";
    for (const state of states) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.textContent = rowLabel(state);
      tr.appendChild(th);

      const edgesFromState = edges.filter((e) => e.from === state.id);
      for (const symbol of columns) {
        const td = document.createElement("td");
        const input = document.createElement("input");
        input.type = "text";
        input.value = cellValue(edges, state.id, symbol, labelOf).join(", ");
        input.addEventListener("change", () => {
          // Track the in-flight edit promise so tests (and callers that
          // care about completion, e.g. a future "saving…" indicator) can
          // await it deterministically instead of racing microtasks.
          this._lastEditPromise = this._onCellEdit(state.id, symbol, input.value, edgesFromState);
        });
        td.appendChild(input);
        tr.appendChild(td);
      }
      this.tbody.appendChild(tr);
    }
  }

  /** Resolve an existing state by label, or create one (spec state-table-view
   * > "Auto-Create State on Type" / "Duplicate name reused, not cloned"). */
  async _resolveOrCreateId(label, index) {
    const existing = this.docStore.getStates().find((s) => s.label === label);
    if (existing) return existing.id;
    const x = 60 + index * 60;
    const y = 60 + this.docStore.getStates().length * 40;
    const result = await this.docStore.apply([{ op: "AddState", label, x, y }]);
    const added = result.patches.find((p) => p.patch === "StateAdded" && p.label === label);
    return added.id;
  }

  async _onCellEdit(fromId, symbol, raw, edgesFromStateAtRenderTime) {
    const labels = parseCellTargets(raw);
    const ids = [];
    let index = 0;
    for (const label of labels) {
      ids.push(await this._resolveOrCreateId(label, index));
      index++;
    }
    // Re-read edges after any auto-create round trips above, in case the
    // document changed (e.g. a new state was actually appended).
    const edgesFromState = this.docStore.getEdges().filter((e) => e.from === fromId);
    const ops = computeCellUpdateOps(fromId, symbol, ids, edgesFromState.length ? edgesFromState : edgesFromStateAtRenderTime);
    if (ops.length) await this.docStore.apply(ops);
  }
}
