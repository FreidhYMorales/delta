import { beforeEach, describe, expect, it, vi } from "vitest";
import { TmDocStore } from "../../store/TmDocStore.js";
import { TmContext } from "../../commands/TmContext.js";
import { TmTableView } from "./TmTableView.js";

function snapshot() {
  return {
    revision: 1,
    states: [
      { id: 1, label: "q0", x: 0, y: 0, initial: true, accepting: false },
      { id: 2, label: "q1", x: 50, y: 0, initial: false, accepting: true },
    ],
    transitions: [
      {
        id: 1,
        from: 1,
        to: 2,
        tapes: [
          { read: "a", write: "b", direction: "R" },
          { read: "c", write: "d", direction: "L" },
        ],
      },
    ],
    derived: { alphabet: ["a", "b", "c", "d"], tape_count: 2, deterministic: true, unreachable: [] },
  };
}

async function setup(snap = snapshot(), hooks = {}) {
  const client = {
    tmSnapshot: vi.fn().mockResolvedValue(snap),
    tmApply: vi.fn().mockResolvedValue({ revision: snap.revision + 1, patches: [], derived: snap.derived }),
    tmUndo: vi.fn(),
    tmRedo: vi.fn(),
  };
  const docStore = new TmDocStore(client);
  await docStore.load();
  const ctx = new TmContext(docStore, hooks);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new TmTableView(container, docStore, ctx);
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
    tapeCells: [...tr.querySelectorAll(".tape-cell")],
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

describe("TmTableView", () => {
  it("renders into a .table-view.tm-table-view wrapper with two tables", async () => {
    const { container } = await setup();
    expect(container.querySelector(".table-view.tm-table-view")).toBeTruthy();
    expect(container.querySelectorAll("table")).toHaveLength(2);
  });

  it("shows the initial/accepting markers in the state name cell, same convention as PDA", async () => {
    const { container } = await setup();
    const rows = [...container.querySelectorAll("tbody")[0].querySelectorAll("tr")].map(stateRowControls);
    expect(rows[0].nameInput.value).toBe("->q0");
    expect(rows[1].nameInput.value).toBe("*q1");
  });

  it("renders one Cinta column per effective tape count, with header labels", async () => {
    const { container } = await setup();
    const headCells = [...container.querySelectorAll("thead")[1].querySelectorAll("th")].map((th) => th.textContent);
    expect(headCells).toEqual(["Origen", "Cinta 1", "Cinta 2", "Destino", ""]);
  });

  it("renders one transition row plus a trailing add-row, with the transition's tape fields", async () => {
    const { container } = await setup();
    const transitionsTbody = container.querySelectorAll("tbody")[1];
    const rows = [...transitionsTbody.querySelectorAll("tr")];
    expect(rows).toHaveLength(2); // one real transition + the add-row

    const { fromSelect, toSelect, tapeCells } = transitionRowControls(rows[0]);
    expect(fromSelect.value).toBe("1");
    expect(toSelect.value).toBe("2");
    expect(tapeCells).toHaveLength(2);
    expect(tapeCells[0].value).toBe("a ; b , R");
    expect(tapeCells[1].value).toBe("c ; d , L");
  });

  it("the add-transition row has one blank tape field per effective tape count", async () => {
    const { container } = await setup();
    const addRow = container.querySelectorAll("tbody")[1].querySelector(".table-add-row");
    const { tapeCells } = transitionRowControls(addRow);
    expect(tapeCells).toHaveLength(2);
    expect(tapeCells.every((c) => c.value === "")).toBe(true);
  });

  it("updates the column count once the document's first transition locks tape_count", async () => {
    const snap = {
      revision: 1,
      states: [{ id: 1, label: "q0", x: 0, y: 0, initial: true, accepting: false }],
      transitions: [],
      derived: { alphabet: [], tape_count: 0, deterministic: true, unreachable: [] },
    };
    const { container, docStore, ctx } = await setup(snap);
    ctx.setTapeCountChoice(3);
    let headCells = [...container.querySelectorAll("thead")[1].querySelectorAll("th")].map((th) => th.textContent);
    expect(headCells).toEqual(["Origen", "Cinta 1", "Cinta 2", "Cinta 3", "Destino", ""]);

    // First transition locks tape_count to 1 (server-side); simulate the
    // resulting snapshot/derived update through a normal apply-result flow.
    docStore.loadSnapshot({
      revision: 2,
      states: snap.states,
      transitions: [{ id: 1, from: 1, to: 1, tapes: [{ read: "x", write: "y", direction: "S" }] }],
      derived: { alphabet: ["x", "y"], tape_count: 1, deterministic: true, unreachable: [] },
    });

    headCells = [...container.querySelectorAll("thead")[1].querySelectorAll("th")].map((th) => th.textContent);
    expect(headCells).toEqual(["Origen", "Cinta 1", "Destino", ""]);
  });
});

describe("TmTableView transition editing", () => {
  it("editing a tape cell issues EditTransition, replacing only that tape index", async () => {
    const { container, client, view } = await setup();
    const row = container.querySelectorAll("tbody")[1].querySelectorAll("tr")[0];
    editValue(transitionRowControls(row).tapeCells[0], "x ; y , S");
    await view._lastEditPromise;

    expect(client.tmApply).toHaveBeenCalledWith([
      {
        op: "EditTransition",
        id: 1,
        tapes: [
          { read: "x", write: "y", direction: "S" },
          { read: "c", write: "d", direction: "L" },
        ],
      },
    ]);
  });

  it("changing the destino select issues RemoveTransition + AddTransition, preserving tapes", async () => {
    const snap = snapshot();
    snap.states.push({ id: 3, label: "q2", x: 100, y: 0, initial: false, accepting: false });
    const { container, client, view } = await setup(snap);
    const row = container.querySelectorAll("tbody")[1].querySelectorAll("tr")[0];
    const { toSelect } = transitionRowControls(row);
    toSelect.value = "3";
    toSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await view._lastEditPromise;

    expect(client.tmApply).toHaveBeenCalledWith([
      { op: "RemoveTransition", id: 1 },
      {
        op: "AddTransition",
        from: 1,
        to: 3,
        tapes: [
          { read: "a", write: "b", direction: "R" },
          { read: "c", write: "d", direction: "L" },
        ],
      },
    ]);
  });

  it("clicking Eliminar on a transition row issues RemoveTransition for that id", async () => {
    const { container, client, view } = await setup();
    const row = container.querySelectorAll("tbody")[1].querySelectorAll("tr")[0];
    transitionRowControls(row).deleteButton.click();
    await view._lastEditPromise;

    expect(client.tmApply).toHaveBeenCalledWith([{ op: "RemoveTransition", id: 1 }]);
  });
});

describe("TmTableView add-transition row", () => {
  it("adding a transition parses every tape field and issues AddTransition", async () => {
    const { container, client, view } = await setup();
    const transitionsTbody = container.querySelectorAll("tbody")[1];
    const addRow = transitionsTbody.querySelector(".table-add-row");
    const { fromSelect, toSelect, tapeCells } = transitionRowControls(addRow);
    fromSelect.value = "1";
    fromSelect.dispatchEvent(new Event("change", { bubbles: true }));
    toSelect.value = "2";
    toSelect.dispatchEvent(new Event("change", { bubbles: true }));
    editValue(tapeCells[0], "e ; f , R");
    editValue(tapeCells[1], "g ; h , L");

    addRow.querySelector(".btn-secondary").click();
    await view._lastEditPromise;

    expect(client.tmApply).toHaveBeenCalledWith([
      {
        op: "AddTransition",
        from: 1,
        to: 2,
        tapes: [
          { read: "e", write: "f", direction: "R" },
          { read: "g", write: "h", direction: "L" },
        ],
      },
    ]);
  });
});

describe("TmTableView state add/delete", () => {
  it("adds a state with the next free label", async () => {
    const { container, client, view } = await setup();
    container.querySelector(".table-actions .btn-secondary:not(.btn-danger)").click();
    await view._lastEditPromise;

    expect(client.tmApply).toHaveBeenCalledWith([
      { op: "AddState", label: "q2", x: expect.any(Number), y: expect.any(Number) },
    ]);
  });

  it("deletes exactly the checked states", async () => {
    const { container, client, view } = await setup();
    const rows = [...container.querySelectorAll("tbody")[0].querySelectorAll("tr")].map(stateRowControls);
    rows[1].deleteCheckbox.click();
    container.querySelector(".table-actions .btn-danger").click();
    await view._lastEditPromise;

    expect(client.tmApply).toHaveBeenCalledWith([{ op: "RemoveState", id: 2 }]);
  });
});

describe("TmTableView state name-cell markers", () => {
  it("typing * on a non-accepting state issues SetAccepting: true", async () => {
    const { container, client, view } = await setup();
    const rows = [...container.querySelectorAll("tbody")[0].querySelectorAll("tr")].map(stateRowControls);
    editValue(rows[0].nameInput, "->*q0");
    await view._lastEditPromise;

    expect(client.tmApply).toHaveBeenCalledWith([{ op: "SetAccepting", id: 1, accepting: true }]);
  });

  it("removing -> from the current initial state clears it (SetInitial: null), no rejection notice", async () => {
    const { container, client, view } = await setup();
    const rows = [...container.querySelectorAll("tbody")[0].querySelectorAll("tr")].map(stateRowControls);
    editValue(rows[0].nameInput, "q0");
    await view._lastEditPromise;

    expect(client.tmApply).toHaveBeenCalledWith([{ op: "SetInitial", id: null }]);
    expect(document.querySelector(".notice")).toBeNull();
  });

  it("renames via ctx.renameState, not a raw docStore.apply, when markers are preserved", async () => {
    const renameState = vi.fn().mockResolvedValue(true);
    const { container, client, view } = await setup(snapshot(), { renameState });
    const rows = [...container.querySelectorAll("tbody")[0].querySelectorAll("tr")].map(stateRowControls);
    editValue(rows[0].nameInput, "->start");
    await view._lastEditPromise;

    expect(renameState).toHaveBeenCalledWith(1, "start");
    expect(client.tmApply).not.toHaveBeenCalled();
  });
});
