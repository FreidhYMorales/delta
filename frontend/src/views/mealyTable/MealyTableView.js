// Mealy state-table view — mirrors `views/table/TableView.js`'s shape
// (alphabet-override field, add/delete-state buttons, editable name cell
// doubling as the initial-marker) but for the Mealy document: no accepting
// column/marker, columns are the INPUT alphabet only, and each cell holds
// `target/output` pairs (`mealyTableLogic.js`) instead of a plain
// destination list. Lives inside Mealy's own upper tab group (main.js).

import { nextStateLabel } from "../diagram/geometry.js";
import {
  cellValue,
  computeCellUpdateOps,
  nameWithMarkers,
  parseAlphabetInput,
  parseCellEntries,
  parseNameCell,
  rowLabel,
} from "./mealyTableLogic.js";

export class MealyTableView {
  /**
   * @param {HTMLElement} container
   * @param {import('../../store/MealyDocStore.js').MealyDocStore} docStore
   * @param {import('../../commands/MealyContext.js').MealyContext} ctx renaming
   *   goes through `ctx.renameState` for the same collision-notice behavior
   *   as everywhere else a state gets renamed.
   */
  constructor(container, docStore, ctx) {
    this.container = container;
    this.docStore = docStore;
    this.ctx = ctx;
    /** @type {string[]|null} explicit input alphabet typed into the
     * "Alfabeto de entrada" field, `null` = follow `docStore.derived.input_alphabet`. */
    this._alphabetOverride = null;
    /** @type {Set<number>} state ids checked for the next bulk delete. */
    this._selectedForDelete = new Set();

    this._build();
    docStore.subscribe(() => this._render());
    this._render();
  }

  _build() {
    this.root = document.createElement("div");
    this.root.className = "table-view mealy-table-view";

    this.actionsBar = document.createElement("div");
    this.actionsBar.className = "table-actions";

    const alphabetField = document.createElement("div");
    alphabetField.className = "table-alphabet-field";
    const alphabetLabel = document.createElement("label");
    alphabetLabel.className = "field-label";
    alphabetLabel.setAttribute("for", "mealy-table-alphabet-input");
    alphabetLabel.textContent = "Alfabeto de entrada (separado por comas)";
    this.alphabetInput = document.createElement("input");
    this.alphabetInput.type = "text";
    this.alphabetInput.id = "mealy-table-alphabet-input";
    this.alphabetInput.className = "string-input";
    this.alphabetInput.placeholder = "a, b, 0, 1…";
    this.alphabetInput.addEventListener("change", () => this._onAlphabetChange());
    alphabetField.append(alphabetLabel, this.alphabetInput);

    const buttonsRow = document.createElement("div");
    buttonsRow.className = "table-buttons-row";
    this.addStateButton = document.createElement("button");
    this.addStateButton.type = "button";
    this.addStateButton.className = "btn-secondary";
    this.addStateButton.textContent = "+ Agregar estado";
    this.addStateButton.addEventListener("click", () => {
      this._lastEditPromise = this._addState();
    });
    this.deleteSelectedButton = document.createElement("button");
    this.deleteSelectedButton.type = "button";
    this.deleteSelectedButton.className = "btn-secondary btn-danger";
    this.deleteSelectedButton.textContent = "Eliminar seleccionados";
    this.deleteSelectedButton.disabled = true;
    this.deleteSelectedButton.addEventListener("click", () => {
      this._lastEditPromise = this._deleteSelected();
    });
    buttonsRow.append(this.addStateButton, this.deleteSelectedButton);

    this.actionsBar.append(alphabetField, buttonsRow);

    this.tableScroll = document.createElement("div");
    this.tableScroll.className = "table-scroll";
    this.table = document.createElement("table");
    this.thead = document.createElement("thead");
    this.tbody = document.createElement("tbody");
    this.table.append(this.thead, this.tbody);
    this.tableScroll.appendChild(this.table);

    this.root.append(this.actionsBar, this.tableScroll);
    this.container.appendChild(this.root);
  }

  _columns() {
    return this._alphabetOverride ?? this.docStore.derived.input_alphabet;
  }

  _onAlphabetChange() {
    const parsed = parseAlphabetInput(this.alphabetInput.value);
    this._alphabetOverride = parsed.length ? parsed : null;
    this._render();
  }

  _renderAlphabetInput() {
    if (document.activeElement === this.alphabetInput) return;
    if (this._alphabetOverride != null) return;
    this.alphabetInput.value = this.docStore.derived.input_alphabet.join(", ");
  }

  _render() {
    this._renderAlphabetInput();

    const states = this.docStore.getStates();
    const edges = this.docStore.getEdges();
    const labelOf = new Map(states.map((s) => [s.id, s.label]));
    const columns = this._columns();
    const liveIds = new Set(states.map((s) => s.id));
    for (const id of this._selectedForDelete) {
      if (!liveIds.has(id)) this._selectedForDelete.delete(id);
    }

    this.thead.innerHTML = "";
    const headRow = document.createElement("tr");
    this.selectAllCheckbox = document.createElement("input");
    this.selectAllCheckbox.type = "checkbox";
    this.selectAllCheckbox.setAttribute("aria-label", "Seleccionar todos los estados");
    this.selectAllCheckbox.addEventListener("change", () => this._onSelectAll());
    headRow.append(
      thWith(this.selectAllCheckbox, undefined, "table-col-narrow"),
      thWith("Estado", 'Escribí "->" al principio del nombre para marcar el estado inicial'),
    );
    for (const symbol of columns) headRow.appendChild(thWith(symbol));
    this.thead.appendChild(headRow);

    this.tbody.innerHTML = "";
    for (const state of states) {
      const tr = document.createElement("tr");
      tr.title = rowLabel(state);

      const deleteCheckbox = document.createElement("input");
      deleteCheckbox.type = "checkbox";
      deleteCheckbox.checked = this._selectedForDelete.has(state.id);
      deleteCheckbox.setAttribute("aria-label", `Seleccionar ${state.label} para eliminar`);
      deleteCheckbox.addEventListener("change", () => {
        if (deleteCheckbox.checked) this._selectedForDelete.add(state.id);
        else this._selectedForDelete.delete(state.id);
        this.deleteSelectedButton.disabled = this._selectedForDelete.size === 0;
      });

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "table-name-input";
      nameInput.value = nameWithMarkers(state);
      nameInput.addEventListener("change", () => {
        this._lastEditPromise = this._onNameCellEdit(state.id, nameInput.value);
      });

      tr.append(tdWith(deleteCheckbox, "table-col-narrow"), thWith(nameInput));

      const edgesFromState = edges.filter((e) => e.from === state.id);
      for (const symbol of columns) {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "table-cell-input";
        input.title = "target/output, p.ej. q1/x";
        input.value = cellValue(edges, state.id, symbol, labelOf).join(", ");
        input.addEventListener("change", () => {
          this._lastEditPromise = this._onCellEdit(state.id, symbol, input.value, edgesFromState);
        });
        tr.appendChild(tdWith(input));
      }
      this.tbody.appendChild(tr);
    }

    this.selectAllCheckbox.checked = states.length > 0 && this._selectedForDelete.size === states.length;
    this.deleteSelectedButton.disabled = this._selectedForDelete.size === 0;
  }

  _onSelectAll() {
    const states = this.docStore.getStates();
    if (this.selectAllCheckbox.checked) {
      for (const s of states) this._selectedForDelete.add(s.id);
    } else {
      this._selectedForDelete.clear();
    }
    this._render();
  }

  async _addState() {
    const states = this.docStore.getStates();
    const label = nextStateLabel(states);
    const x = 60 + (states.length % 6) * 70;
    const y = 60 + Math.floor(states.length / 6) * 70;
    await this.docStore.apply([{ op: "AddState", label, x, y }]);
  }

  async _deleteSelected() {
    const ids = [...this._selectedForDelete];
    if (!ids.length) return;
    this._selectedForDelete.clear();
    await this.docStore.apply(ids.map((id) => ({ op: "RemoveState", id })));
  }

  /** Applies the name cell's `->` prefix: rename and/or mark-initial. No
   * exclusivity check/rejection notice needed here — unlike the FA table,
   * `MealyDoc::set_initial` is a single `Option<StateId>` slot that silently
   * replaces whoever held it before (same as `mealyRegistry.js`'s
   * `state.markInitial` action), so there is no "already taken" case to
   * reject.
   * @param {number} id @param {string} raw */
  async _onNameCellEdit(id, raw) {
    const state = this.docStore.getState(id);
    if (!state) return;
    const { label, initial } = parseNameCell(raw);

    if (initial !== state.initial) {
      await this.docStore.apply([{ op: "SetInitial", id: initial ? id : null }]);
    }

    if (label && label !== state.label) {
      await this.ctx.renameState(id, label);
    }
  }

  /** Resolve an existing state by label, or create one — same "auto-create,
   * reuse by label" convention as the FA table's `_resolveOrCreateId`. */
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
    const pairs = parseCellEntries(raw);
    const desired = [];
    let index = 0;
    for (const { label, output } of pairs) {
      const to = await this._resolveOrCreateId(label, index);
      desired.push({ to, output });
      index++;
    }
    const edgesFromState = this.docStore.getEdges().filter((e) => e.from === fromId);
    const ops = computeCellUpdateOps(
      fromId,
      symbol,
      desired,
      edgesFromState.length ? edgesFromState : edgesFromStateAtRenderTime,
    );
    if (ops.length) await this.docStore.apply(ops);
  }
}

/** @param {string|HTMLElement} content @param {string} [title] @param {string} [className] */
function thWith(content, title, className) {
  const th = document.createElement("th");
  if (typeof content === "string") th.textContent = content;
  else th.appendChild(content);
  if (title) th.title = title;
  if (className) th.className = className;
  return th;
}

/** @param {HTMLElement} content @param {string} [className] */
function tdWith(content, className) {
  const td = document.createElement("td");
  td.appendChild(content);
  if (className) td.className = className;
  return td;
}
