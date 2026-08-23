import { beforeEach, describe, expect, it, vi } from "vitest";
import { PdaDocStore } from "../../store/PdaDocStore.js";
import { PdaContext } from "../../commands/PdaContext.js";
import { PdaTableView } from "./PdaTableView.js";

function snapshot() {
  return {
    revision: 1,
    states: [
      { id: 1, label: "q0", x: 0, y: 0, initial: true, accepting: false },
      { id: 2, label: "q1", x: 50, y: 0, initial: false, accepting: true },
    ],
    transitions: [{ id: 1, from: 1, to: 2, input: "a", pop: ["Z"], push: ["A", "Z"] }],
    derived: { input_alphabet: ["a"], stack_alphabet: ["A", "Z"], deterministic: true, unreachable: [] },
  };
}

async function setup(snap = snapshot(), hooks = {}) {
  const client = {
    pdaSnapshot: vi.fn().mockResolvedValue(snap),
    pdaApply: vi.fn().mockResolvedValue({ revision: snap.revision + 1, patches: [], derived: snap.derived }),
    pdaUndo: vi.fn(),
    pdaRedo: vi.fn(),
  };
  const docStore = new PdaDocStore(client);
  await docStore.load();
  const ctx = new PdaContext(docStore, hooks);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new PdaTableView(container, docStore, ctx);
  return { client, docStore, ctx, container, view };
}

function stateRowControls(tr) {
  return {
    deleteCheckbox: tr.querySelector('td input[type="checkbox"]'),
    nameInput: tr.querySelector(".table-name-input"),
  };
}

function transitionRowControls(tr) {
  const [fromSelect, toSelect] = tr.querySelectorAll("select");
  return {
    fromSelect,
    toSelect,
    inputCell: tr.querySelector(".input-cell"),
    popCell: tr.querySelector(".pop-cell"),
    pushCell: tr.querySelector(".push-cell"),
    deleteButton: tr.querySelector(".btn-danger"),
  };
}

function editValue(input, value) {
  input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("PdaTableView", () => {
  it("renders into a .table-view.pda-table-view wrapper with two tables", async () => {
    const { container } = await setup();
    expect(container.querySelector(".table-view.pda-table-view")).toBeTruthy();
    expect(container.querySelectorAll("table")).toHaveLength(2);
  });

  it("shows the initial/accepting markers in the state name cell, FA convention", async () => {
    const { container } = await setup();
    const rows = [...container.querySelectorAll("tbody")[0].querySelectorAll("tr")].map(stateRowControls);
    expect(rows[0].nameInput.value).toBe("->q0");
    expect(rows[1].nameInput.value).toBe("*q1");
  });

  it("renders one transition row plus a trailing add-row, with the transition's fields", async () => {
    const { container } = await setup();
    const transitionsTbody = container.querySelectorAll("tbody")[1];
    const rows = [...transitionsTbody.querySelectorAll("tr")];
    expect(rows).toHaveLength(2); // one real transition + the add-row

    const { fromSelect, toSelect, inputCell, popCell, pushCell } = transitionRowControls(rows[0]);
    expect(fromSelect.value).toBe("1");
    expect(toSelect.value).toBe("2");
    expect(inputCell.value).toBe("a");
    expect(popCell.value).toBe("Z");
    expect(pushCell.value).toBe("A Z");
  });
});

describe("PdaTableView transition editing", () => {
  it("editing the input cell issues EditTransition, keeping pop/push", async () => {
    const { container, client, view } = await setup();
    const row = container.querySelectorAll("tbody")[1].querySelectorAll("tr")[0];
    editValue(transitionRowControls(row).inputCell, "b");
    await view._lastEditPromise;

    expect(client.pdaApply).toHaveBeenCalledWith([{ op: "EditTransition", id: 1, input: "b", pop: ["Z"], push: ["A", "Z"] }]);
  });

  it("changing the destino select issues RemoveTransition + AddTransition (endpoints are immutable)", async () => {
    const snap = snapshot();
    snap.states.push({ id: 3, label: "q2", x: 100, y: 0, initial: false, accepting: false });
    const { container, client, view } = await setup(snap);
    const row = container.querySelectorAll("tbody")[1].querySelectorAll("tr")[0];
    const { toSelect } = transitionRowControls(row);
    toSelect.value = "3";
    toSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await view._lastEditPromise;

    expect(client.pdaApply).toHaveBeenCalledWith([
      { op: "RemoveTransition", id: 1 },
      { op: "AddTransition", from: 1, to: 3, input: "a", pop: ["Z"], push: ["A", "Z"] },
    ]);
  });

  it("clicking Eliminar on a transition row issues RemoveTransition for that id", async () => {
    const { container, client, view } = await setup();
    const row = container.querySelectorAll("tbody")[1].querySelectorAll("tr")[0];
    transitionRowControls(row).deleteButton.click();
    await view._lastEditPromise;

    expect(client.pdaApply).toHaveBeenCalledWith([{ op: "RemoveTransition", id: 1 }]);
  });
});

describe("PdaTableView add-transition row", () => {
  it("adding a second transition between an already-connected pair issues AddTransition, keeps the first", async () => {
    const { container, client, view } = await setup();
    const transitionsTbody = container.querySelectorAll("tbody")[1];
    const addRow = transitionsTbody.querySelector(".table-add-row");
    const { fromSelect, toSelect, inputCell, popCell, pushCell } = transitionRowControls(addRow);
    fromSelect.value = "1";
    fromSelect.dispatchEvent(new Event("change", { bubbles: true }));
    toSelect.value = "2";
    toSelect.dispatchEvent(new Event("change", { bubbles: true }));
    editValue(inputCell, "b");
    editValue(popCell, "");
    editValue(pushCell, "");

    addRow.querySelector(".btn-secondary").click();
    await view._lastEditPromise;

    expect(client.pdaApply).toHaveBeenCalledWith([{ op: "AddTransition", from: 1, to: 2, input: "b", pop: [], push: [] }]);
  });
});

describe("PdaTableView state add/delete", () => {
  it("adds a state with the next free label", async () => {
    const { container, client, view } = await setup();
    container.querySelector(".table-actions .btn-secondary:not(.btn-danger)").click();
    await view._lastEditPromise;

    expect(client.pdaApply).toHaveBeenCalledWith([
      { op: "AddState", label: "q2", x: expect.any(Number), y: expect.any(Number) },
    ]);
  });

  it("deletes exactly the checked states", async () => {
    const { container, client, view } = await setup();
    const rows = [...container.querySelectorAll("tbody")[0].querySelectorAll("tr")].map(stateRowControls);
    rows[1].deleteCheckbox.click();
    container.querySelector(".table-actions .btn-danger").click();
    await view._lastEditPromise;

    expect(client.pdaApply).toHaveBeenCalledWith([{ op: "RemoveState", id: 2 }]);
  });
});

describe("PdaTableView state name-cell markers", () => {
  it("typing * on a non-accepting state issues SetAccepting: true", async () => {
    const { container, client, view } = await setup();
    const rows = [...container.querySelectorAll("tbody")[0].querySelectorAll("tr")].map(stateRowControls);
    editValue(rows[0].nameInput, "->*q0");
    await view._lastEditPromise;

    expect(client.pdaApply).toHaveBeenCalledWith([{ op: "SetAccepting", id: 1, accepting: true }]);
  });

  it("removing -> from the current initial state clears it (SetInitial: null), no rejection notice", async () => {
    const { container, client, view } = await setup();
    const rows = [...container.querySelectorAll("tbody")[0].querySelectorAll("tr")].map(stateRowControls);
    editValue(rows[0].nameInput, "q0");
    await view._lastEditPromise;

    expect(client.pdaApply).toHaveBeenCalledWith([{ op: "SetInitial", id: null }]);
    expect(document.querySelector(".notice")).toBeNull();
  });

  it("renames via ctx.renameState, not a raw docStore.apply, when markers are preserved", async () => {
    const renameState = vi.fn().mockResolvedValue(true);
    const { container, client, view } = await setup(snapshot(), { renameState });
    const rows = [...container.querySelectorAll("tbody")[0].querySelectorAll("tr")].map(stateRowControls);
    editValue(rows[0].nameInput, "->start");
    await view._lastEditPromise;

    expect(renameState).toHaveBeenCalledWith(1, "start");
    expect(client.pdaApply).not.toHaveBeenCalled();
  });
});
