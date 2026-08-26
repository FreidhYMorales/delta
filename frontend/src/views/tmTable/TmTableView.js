// TM "Tabla de estados" view — mirrors `pdaTable/PdaTableView.js`'s exact
// two-stacked-tables structure. "Estados" is a near-verbatim copy of PDA's
// (TM has both initial AND accepting, exactly PDA's shape, so it reuses
// `nameWithMarkers`/`parseNameCell`/`rowLabel` from `views/table/tableLogic.js`
// directly). "Transiciones" differs from PDA's fixed 3-column table: a TM
// transition's field count is `effectiveTapeCount(docStore, ctx)` (1 to 5,
// `TmDoc::tape_count`, locked by the first transition ever added), so the
// header and every row's cell count are recomputed on every render — the
// count can change the moment the very first transition locks `tape_count`.
//
// Each `Cinta N` cell is a single text input holding
// `formatTapeOpForPrompt(tapes[i])` (the same "read ; write , direction"
// format the diagram's per-tape prompt and label already use, so the table
// and diagram/prompt flow stay visually consistent). Editing it parses via
// `parseTapeOpText` and rebuilds the transition's full `tapes` array with
// just that index replaced — `EditTransition` always replaces the whole
// payload, same "no partial-field replace" rule as PDA's.

import { nameWithMarkers, parseNameCell, rowLabel } from "../table/tableLogic.js";
import { effectiveTapeCount, formatTapeOpForPrompt } from "../tmDiagram/tmLogic.js";
import { computeAddTransitionOp, computeRetargetOps, computeTapeFieldEditOp } from "./tmTableLogic.js";
import { nextStateLabel } from "../diagram/geometry.js";
import { createCopyTableButton } from "../../ui/copyTable.js";

export class TmTableView {
  /**
   * @param {HTMLElement} container
   * @param {import('../../store/TmDocStore.js').TmDocStore} docStore
   * @param {import('../../commands/TmContext.js').TmContext} ctx renaming
   *   goes through `ctx.renameState`, and `effectiveTapeCount` needs
   *   `ctx.tapeCountChoice` for the pre-lock (tape_count === 0) case.
   */
  constructor(container, docStore, ctx) {
    this.container = container;
    this.docStore = docStore;
    this.ctx = ctx;
    /** @type {Set<number>} state ids checked for the next bulk delete. */
    this._selectedForDelete = new Set();
    /** @type {{from:number|null, to:number|null, tapeTexts:string[]}} the
     * "+ Agregar transición" row's in-progress values. */
    this._newTransition = { from: null, to: null, tapeTexts: [] };

    this._build();
    docStore.subscribe(() => this._render());
    // Also re-render on `ctx` changes, not just `docStore`'s — the
    // Transiciones header's column count falls back to
    // `ctx.tapeCountChoice` before `TmDoc::tape_count` locks (see
    // `effectiveTapeCount`), so it must stay live to the toolbar's
    // pre-lock tape-count choice, same as `TmToolbar`/`TmSimView`/
    // `TmDiagramView`'s own `ctx.subscribe` calls.
    ctx.subscribe(() => this._render());
    this._render();
  }

  _build() {
    this.root = document.createElement("div");
    this.root.className = "table-view tm-table-view";

    this.statesActionsBar = document.createElement("div");
    this.statesActionsBar.className = "table-actions";
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
    this.copyStatesTableButton = createCopyTableButton(() => this.statesTable);
    const statesButtonsRow = document.createElement("div");
    statesButtonsRow.className = "table-buttons-row";
    statesButtonsRow.append(this.addStateButton, this.deleteSelectedButton, this.copyStatesTableButton);
    this.statesActionsBar.append(statesButtonsRow);

    this.statesTableScroll = document.createElement("div");
    this.statesTableScroll.className = "table-scroll";
    this.statesTable = document.createElement("table");
    this.statesThead = document.createElement("thead");
    this.statesTbody = document.createElement("tbody");
    this.statesTable.append(this.statesThead, this.statesTbody);
    this.statesTableScroll.appendChild(this.statesTable);

    this.transitionsHeading = document.createElement("h3");
    this.transitionsHeading.className = "table-section-heading";
    this.transitionsHeading.textContent = "Transiciones";

    this.transitionsTableScroll = document.createElement("div");
    this.transitionsTableScroll.className = "table-scroll";
    this.transitionsTable = document.createElement("table");
    this.transitionsThead = document.createElement("thead");
    this.transitionsTbody = document.createElement("tbody");
    this.transitionsTable.append(this.transitionsThead, this.transitionsTbody);
    this.transitionsTableScroll.appendChild(this.transitionsTable);

    this.root.append(
      this.statesActionsBar,
      this.statesTableScroll,
      this.transitionsHeading,
      this.transitionsTableScroll,
    );
    this.container.appendChild(this.root);
  }

  _render() {
    this._renderStates();
    this._renderTransitions();
  }

  _renderStates() {
    const states = this.docStore.getStates();
    const liveIds = new Set(states.map((s) => s.id));
    for (const id of this._selectedForDelete) {
      if (!liveIds.has(id)) this._selectedForDelete.delete(id);
    }

    this.statesThead.innerHTML = "";
    const headRow = document.createElement("tr");
    this.selectAllCheckbox = document.createElement("input");
    this.selectAllCheckbox.type = "checkbox";
    this.selectAllCheckbox.setAttribute("aria-label", "Seleccionar todos los estados");
    this.selectAllCheckbox.addEventListener("change", () => this._onSelectAll());
    headRow.append(
      thWith(this.selectAllCheckbox, undefined, "table-col-narrow"),
      thWith("Estado", 'Escribí "->" para inicial y "*" para aceptación, p.ej. "->*q0"'),
    );
    this.statesThead.appendChild(headRow);

    this.statesTbody.innerHTML = "";
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
      this.statesTbody.appendChild(tr);
    }

    this.selectAllCheckbox.checked = states.length > 0 && this._selectedForDelete.size === states.length;
    this.deleteSelectedButton.disabled = this._selectedForDelete.size === 0;
  }

  _renderTransitions() {
    const states = this.docStore.getStates();
    const transitions = this.docStore.getTransitions();
    const tapeCount = effectiveTapeCount(this.docStore, this.ctx);

    this.transitionsThead.innerHTML = "";
    const headRow = document.createElement("tr");
    headRow.appendChild(thWith("Origen"));
    for (let i = 0; i < tapeCount; i++) headRow.appendChild(thWith(`Cinta ${i + 1}`));
    headRow.append(thWith("Destino"), thWith(""));
    this.transitionsThead.appendChild(headRow);

    this.transitionsTbody.innerHTML = "";
    for (const t of transitions) {
      const tr = document.createElement("tr");
      tr.dataset.transitionId = String(t.id);

      const fromSelect = this._stateSelect(states, t.from, (value) => {
        this._lastEditPromise = this._onRetarget(t.id, "from", value);
      });
      const toSelect = this._stateSelect(states, t.to, (value) => {
        this._lastEditPromise = this._onRetarget(t.id, "to", value);
      });

      const tapeCells = [];
      for (let i = 0; i < tapeCount; i++) {
        const tape = t.tapes[i];
        const cell = this._transitionFieldInput(tape ? formatTapeOpForPrompt(tape) : "", "tape-cell", (value) => {
          this._lastEditPromise = this._onTapeFieldEdit(t.id, i, value);
        });
        tapeCells.push(cell);
      }

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "btn-secondary btn-danger";
      deleteButton.textContent = "Eliminar";
      deleteButton.addEventListener("click", () => {
        this._lastEditPromise = this.docStore.apply([{ op: "RemoveTransition", id: t.id }]);
      });

      tr.appendChild(tdWith(fromSelect));
      for (const cell of tapeCells) tr.appendChild(tdWith(cell));
      tr.append(tdWith(toSelect), tdWith(deleteButton));
      this.transitionsTbody.appendChild(tr);
    }

    this.transitionsTbody.appendChild(this._buildAddTransitionRow(states, tapeCount));
  }

  _stateSelect(states, selectedId, onChange) {
    const select = document.createElement("select");
    select.className = "table-cell-input";
    for (const s of states) {
      const option = document.createElement("option");
      option.value = String(s.id);
      option.textContent = s.label;
      if (s.id === selectedId) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => onChange(Number(select.value)));
    return select;
  }

  _transitionFieldInput(value, className, onChange) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = `table-cell-input ${className}`;
    input.value = value;
    input.addEventListener("change", () => onChange(input.value));
    return input;
  }

  _buildAddTransitionRow(states, tapeCount) {
    const tr = document.createElement("tr");
    tr.className = "table-add-row";

    // Keep the in-progress tapeTexts array's length in sync with the
    // current effective tape count — it can change the moment the very
    // first transition locks `tape_count`.
    const tapeTexts = this._newTransition.tapeTexts;
    if (tapeTexts.length !== tapeCount) {
      tapeTexts.length = tapeCount;
      for (let i = 0; i < tapeCount; i++) if (tapeTexts[i] == null) tapeTexts[i] = "";
    }

    const fromSelect = this._stateSelect(states, this._newTransition.from ?? states[0]?.id ?? null, (value) => {
      this._newTransition.from = value;
    });
    const toSelect = this._stateSelect(states, this._newTransition.to ?? states[0]?.id ?? null, (value) => {
      this._newTransition.to = value;
    });
    if (!states.length) {
      fromSelect.disabled = true;
      toSelect.disabled = true;
    }
    if (this._newTransition.from == null) this._newTransition.from = states[0]?.id ?? null;
    if (this._newTransition.to == null) this._newTransition.to = states[0]?.id ?? null;

    const tapeCells = tapeTexts.map((text, i) =>
      this._transitionFieldInput(text, "tape-cell", (value) => {
        this._newTransition.tapeTexts[i] = value;
      }),
    );

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "btn-secondary";
    addButton.textContent = "+ Agregar";
    addButton.disabled = !states.length;
    addButton.addEventListener("click", () => {
      this._lastEditPromise = this._onAddTransition();
    });

    tr.appendChild(tdWith(fromSelect));
    for (const cell of tapeCells) tr.appendChild(tdWith(cell));
    tr.append(tdWith(toSelect), tdWith(addButton));
    return tr;
  }

  async _onAddTransition() {
    const op = computeAddTransitionOp(this._newTransition);
    if (!op) return;
    const tapeCount = this._newTransition.tapeTexts.length;
    this._newTransition = {
      from: this._newTransition.from,
      to: this._newTransition.to,
      tapeTexts: new Array(tapeCount).fill(""),
    };
    await this.docStore.apply([op]);
  }

  async _onTapeFieldEdit(transitionId, tapeIndex, raw) {
    const transition = this.docStore.getTransition(transitionId);
    if (!transition) return;
    const op = computeTapeFieldEditOp(transition, tapeIndex, raw);
    if (op) await this.docStore.apply([op]);
  }

  async _onRetarget(transitionId, field, newStateId) {
    const transition = this.docStore.getTransition(transitionId);
    if (!transition) return;
    const ops = computeRetargetOps(transition, field, newStateId);
    if (ops) await this.docStore.apply(ops);
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

  /** Applies the name cell's `->`/`*` prefixes: rename, mark-initial, and/or
   * toggle-accepting. `SetInitial` stays a silent single-slot replace, same
   * as PDA's own name-cell handling. @param {number} id @param {string} raw */
  async _onNameCellEdit(id, raw) {
    const state = this.docStore.getState(id);
    if (!state) return;
    const { label, initial, accepting } = parseNameCell(raw);

    if (initial !== state.initial) {
      await this.docStore.apply([{ op: "SetInitial", id: initial ? id : null }]);
    }
    if (accepting !== state.accepting) {
      await this.docStore.apply([{ op: "SetAccepting", id, accepting }]);
    }
    if (label && label !== state.label) {
      await this.ctx.renameState(id, label);
    }
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
