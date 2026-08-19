// L1: state-table-view (task 7.5), kept in sync with the diagram purely by
// re-rendering on every `DocStore` change (design D6: "Single `DocStore`
// ... feeds all views"). Column format mirrors kflap-v0.1's table (README):
// one column per Σ symbol, cells are comma-separated destination labels.
// There is no always-present `ε` column (2026-08-09, per user request) — it
// only appears when explicitly requested via the "Alfabeto" input (see
// `parseAlphabetInput`). Lives inside the right column's upper tab group
// (main.js) — visibility is the tab's job now, not a `<details>` collapse
// toggle.
//
// Each row also has: a checkbox for bulk delete, and the state's name as an
// editable text input that doubles as the initial/accepting toggle — typing
// `->` at the start marks the state initial (exclusive: only one state may
// have it, same as the diagram's "Marcar como inicial"), `*` marks it
// accepting. There is deliberately NO exclusivity on `*`: a DFA/NFA's set of
// final states can have more than one member (F ⊆ Q, not a single state) —
// enforcing "only one accepting state" the same way as initial would make
// the table unable to represent a large share of real automatons. Only
// `->` gets the "already taken" rejection the user asked for.

import { nextStateLabel } from "../diagram/geometry.js";
import { showNotice } from "../../ui/notice.js";
import {
  EPSILON,
  cellValue,
  computeCellUpdateOps,
  nameWithMarkers,
  parseAlphabetInput,
  parseCellTargets,
  parseNameCell,
  rowLabel,
} from "./tableLogic.js";

export class TableView {
  /**
   * @param {HTMLElement} container
   * @param {import('../../store/DocStore.js').DocStore} docStore
   * @param {import('../../commands/context.js').ViewContext} ctx renaming
   *   goes through `ctx.renameState` (not a raw `docStore.apply`), so a name
   *   collision surfaces the same visible notice as every other rename path
   *   (task 7.9) instead of silently doing nothing.
   */
  constructor(container, docStore, ctx) {
    this.container = container;
    this.docStore = docStore;
    this.ctx = ctx;
    /** @type {string[]|null} explicit alphabet typed into the "Alfabeto"
     * input, overriding which columns the table shows. `null` means "follow
     * `docStore.derived.alphabet` automatically" (the previous, only
     * behavior) — cleared back to `null` when the input is emptied. */
    this._alphabetOverride = null;
    /** @type {Set<number>} state ids checked for the next bulk delete. */
    this._selectedForDelete = new Set();

    this._build();
    docStore.subscribe(() => this._render());
    this._render();
  }

  _build() {
    this.root = document.createElement("div");
    this.root.className = "table-view";

    // Sticky actions bar (alphabet input + add/delete-selected buttons):
    // `position: sticky` against `.tab-panels` (the nearest scrolling
    // ancestor) keeps it reachable above the table no matter how far down
    // a long list of states has been scrolled — the request was "una zona
    // donde se mantengan siempre visibles... incluso si hubiera demasiados
    // estados", which a fixed bar below the table can't guarantee (you'd
    // have to scroll past every row to reach it).
    this.actionsBar = document.createElement("div");
    this.actionsBar.className = "table-actions";

    const alphabetField = document.createElement("div");
    alphabetField.className = "table-alphabet-field";
    const alphabetLabel = document.createElement("label");
    alphabetLabel.className = "field-label";
    alphabetLabel.setAttribute("for", "table-alphabet-input");
    alphabetLabel.textContent = "Alfabeto (separado por comas)";
    this.alphabetInput = document.createElement("input");
    this.alphabetInput.type = "text";
    this.alphabetInput.id = "table-alphabet-input";
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
    return this._alphabetOverride ?? this.docStore.derived.alphabet;
  }

  _onAlphabetChange() {
    const parsed = parseAlphabetInput(this.alphabetInput.value);
    this._alphabetOverride = parsed.length ? parsed : null;
    this._render();
  }

  /** Mirrors `FormalView._renderIfNotEditing`'s convention: don't clobber
   * what the user is actively typing, and once they've set an explicit
   * alphabet, don't silently overwrite it with whatever the document
   * derives on its own. */
  _renderAlphabetInput() {
    if (document.activeElement === this.alphabetInput) return;
    if (this._alphabetOverride != null) return;
    this.alphabetInput.value = this.docStore.derived.alphabet.join(", ");
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
      thWith("Estado", 'Escribí "->" al principio del nombre para marcar el estado inicial, "*" para aceptación (se pueden combinar: "->*q0")'),
    );
    for (const symbol of columns) headRow.appendChild(thWith(symbol === EPSILON ? "cadena vacía" : symbol));
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
        input.value = cellValue(edges, state.id, symbol, labelOf).join(", ");
        input.addEventListener("change", () => {
          // Track the in-flight edit promise so tests (and callers that
          // care about completion, e.g. a future "saving…" indicator) can
          // await it deterministically instead of racing microtasks.
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

  /** Applies whatever the name cell's `->`/`*` prefixes (`parseNameCell`)
   * ask for: rename, mark-initial (rejected with a visible notice if some
   * *other* state already has it — only one state may be initial), and
   * mark/unmark accepting. A prefix that's *missing* but was present before
   * (the user deleted it and re-submitted) clears that flag, so the field
   * is fully bidirectional — not just an initial-set mechanism.
   * @param {number} id @param {string} raw */
  async _onNameCellEdit(id, raw) {
    const state = this.docStore.getState(id);
    if (!state) return;
    const { label, initial, accepting } = parseNameCell(raw);

    if (initial && !state.initial) {
      const currentInitial = this.docStore.getStates().find((s) => s.initial);
      if (currentInitial && currentInitial.id !== id) {
        showNotice({
          kind: "error",
          title: "Ya hay un estado inicial",
          message:
            `"${currentInitial.label}" ya es el estado inicial — solo puede haber uno. ` +
            `Quitá el "->" de "${currentInitial.label}" primero si querés mover la marca.`,
        });
      } else {
        await this.docStore.apply([{ op: "SetInitial", id }]);
      }
    } else if (!initial && state.initial) {
      await this.docStore.apply([{ op: "SetInitial", id: null }]);
    }

    if (accepting !== state.accepting) {
      await this.docStore.apply([{ op: "SetAccepting", id, accepting }]);
    }

    if (label && label !== state.label) {
      await this.ctx.renameState(id, label);
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
