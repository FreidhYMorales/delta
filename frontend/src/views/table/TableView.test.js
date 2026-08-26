import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../../store/DocStore.js";
import { ViewContext } from "../../commands/context.js";
import { TableView } from "./TableView.js";

function snapshot() {
  return {
    revision: 1,
    states: [
      { id: 1, label: "q0", x: 0, y: 0, initial: true, accepting: false },
      { id: 2, label: "q1", x: 50, y: 0, initial: false, accepting: true },
    ],
    edges: [{ from: 1, to: 1, epsilon: false, symbols: ["a"] }, { from: 1, to: 2, epsilon: false, symbols: ["b"] }],
    derived: { classification: "Dfa", alphabet: ["a", "b"], unreachable: [] },
  };
}

async function setup(snap = snapshot(), hooks = {}) {
  const client = {
    docSnapshot: vi.fn().mockResolvedValue(snap),
    docApply: vi.fn().mockResolvedValue({ revision: snap.revision + 1, patches: [], derived: snap.derived }),
    docUndo: vi.fn(),
    docRedo: vi.fn(),
  };
  const docStore = new DocStore(client);
  await docStore.load();
  const ctx = new ViewContext(docStore, hooks);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new TableView(container, docStore, ctx);
  return { client, docStore, ctx, container, view };
}

/** Row helper: the leading delete-checkbox cell is a fixed position, symbol
 * cells use `.table-cell-input`. */
function rowControls(tr) {
  return {
    deleteCheckbox: tr.querySelector('td input[type="checkbox"]'),
    nameInput: tr.querySelector(".table-name-input"),
    cellInputs: [...tr.querySelectorAll(".table-cell-input")],
  };
}

function editName(nameInput, value) {
  nameInput.value = value;
  nameInput.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("TableView (task 7.5)", () => {
  it("renders into a plain .table-view wrapper (visibility is the tab group's job, main.js)", async () => {
    const { container } = await setup();
    expect(container.querySelector(".table-view")).toBeTruthy();
    expect(container.querySelector(".table-view table")).toBeTruthy();
  });

  it("renders one column per alphabet symbol, no epsilon column unless requested, and one row per state", async () => {
    const { container } = await setup();
    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["", "Estado", "a", "b"]);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
  });

  it("shows the initial/accepting state as ->/* prefixes on the editable name", async () => {
    const { container } = await setup();
    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    expect(rows[0].nameInput.value).toBe("->q0"); // initial
    expect(rows[1].nameInput.value).toBe("*q1"); // accepting
  });

  it("shows existing destinations in each cell", async () => {
    const { container } = await setup();
    const firstRow = rowControls(container.querySelectorAll("tbody tr")[0]);
    expect(firstRow.cellInputs[0].value).toBe("q0"); // column a: self loop
    expect(firstRow.cellInputs[1].value).toBe("q1"); // column b
  });

  it("re-renders when the DocStore changes", async () => {
    const { container, docStore } = await setup();
    docStore.loadSnapshot({
      revision: 2,
      states: [],
      edges: [],
      derived: { classification: "Dfa", alphabet: [], unreachable: [] },
    });
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
  });
});

describe("TableView editing (spec state-table-view)", () => {
  it("reuses an existing state by label rather than cloning it", async () => {
    const { container, client, view } = await setup();
    const firstRow = rowControls(container.querySelectorAll("tbody tr")[0]); // q0
    const cellB = firstRow.cellInputs[1]; // column b, currently "q1"
    cellB.value = "q1"; // unchanged, but re-typed
    cellB.dispatchEvent(new Event("change", { bubbles: true }));
    await view._lastEditPromise;

    // No AddState call for an already-existing label.
    for (const call of client.docApply.mock.calls) {
      expect(call[0].some((op) => op.op === "AddState")).toBe(false);
    }
  });

  it("auto-creates a not-yet-existing state typed as a target (spec Auto-Create State on Type)", async () => {
    const { container, client, view } = await setup();
    client.docApply.mockImplementation(async (ops) => {
      if (ops.some((op) => op.op === "AddState")) {
        return {
          revision: 2,
          patches: [{ patch: "StateAdded", id: 99, label: "q3", x: 0, y: 0 }],
          derived: { classification: "Dfa", alphabet: ["a", "b"], unreachable: [] },
        };
      }
      return { revision: 3, patches: [], derived: { classification: "Dfa", alphabet: ["a", "b"], unreachable: [] } };
    });

    const firstRow = rowControls(container.querySelectorAll("tbody tr")[0]); // q0
    const cellB = firstRow.cellInputs[1];
    cellB.value = "q3";
    cellB.dispatchEvent(new Event("change", { bubbles: true }));
    await view._lastEditPromise;

    const addStateCall = client.docApply.mock.calls.find((c) => c[0].some((op) => op.op === "AddState"));
    expect(addStateCall[0]).toEqual([{ op: "AddState", label: "q3", x: expect.any(Number), y: expect.any(Number) }]);

    const setEdgeCall = client.docApply.mock.calls.find((c) => c[0].some((op) => op.op === "SetEdge"));
    expect(setEdgeCall[0]).toEqual(
      expect.arrayContaining([{ op: "SetEdge", from: 1, to: 99, epsilon: false, symbols: ["b"] }]),
    );
  });
});

describe("TableView alphabet override", () => {
  it("pre-fills the alphabet input with the derived alphabet", async () => {
    const { container } = await setup();
    expect(container.querySelector('input[type="text"].string-input').value).toBe("a, b");
  });

  it("switches the table's columns to a user-typed alphabet, comma-separated", async () => {
    const { container } = await setup();
    const input = container.querySelector(".table-actions input.string-input");
    input.value = "0, 1, 00";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["", "Estado", "0", "1", "00"]);
  });

  it("reverts to the derived alphabet when the input is cleared", async () => {
    const { container } = await setup();
    const input = container.querySelector(".table-actions input.string-input");
    input.value = "z";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.value = "";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["", "Estado", "a", "b"]);
  });

  it("shows an epsilon column labeled 'cadena vacía' when the alphabet has a blank entry", async () => {
    const { container } = await setup();
    const input = container.querySelector(".table-actions input.string-input");
    input.value = "a, ,b";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["", "Estado", "a", "cadena vacía", "b"]);
  });

  it("does not add an epsilon column for a genuinely empty entry (stray comma)", async () => {
    const { container } = await setup();
    const input = container.querySelector(".table-actions input.string-input");
    input.value = "a,,b";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["", "Estado", "a", "b"]);
  });
});

describe("TableView add/delete state buttons", () => {
  it("adds a state with the next free label", async () => {
    const { container, client, view } = await setup();
    container.querySelector(".table-buttons-row .btn-secondary:not(.btn-danger)").click();
    await view._lastEditPromise;

    expect(client.docApply).toHaveBeenCalledWith([
      { op: "AddState", label: "q2", x: expect.any(Number), y: expect.any(Number) },
    ]);
  });

  it("the delete-selected button starts disabled, enables once a row is checked, and deletes exactly the checked states", async () => {
    const { container, client, view } = await setup();
    const deleteBtn = container.querySelector(".btn-danger");
    expect(deleteBtn.disabled).toBe(true);

    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    rows[1].deleteCheckbox.click();
    expect(deleteBtn.disabled).toBe(false);

    deleteBtn.click();
    await view._lastEditPromise;

    expect(client.docApply).toHaveBeenCalledWith([{ op: "RemoveState", id: 2 }]);
  });

  it("the select-all checkbox checks every row, and unchecking it clears the selection", async () => {
    const { container } = await setup();
    // `_render()` rebuilds the whole `<thead>` (same as every row), so the
    // header checkbox must be re-queried after each click instead of reusing
    // a stale, now-detached reference to the pre-render element.
    container.querySelector("thead th input").click();

    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    expect(rows.every((r) => r.deleteCheckbox.checked)).toBe(true);
    expect(container.querySelector(".btn-danger").disabled).toBe(false);

    container.querySelector("thead th input").click();
    const rowsAfter = [...container.querySelectorAll("tbody tr")].map(rowControls);
    expect(rowsAfter.every((r) => !r.deleteCheckbox.checked)).toBe(true);
  });
});

describe("TableView initial/accepting via ->/* name-cell prefixes", () => {
  it("typing -> before a name marks that state initial when no other state has it", async () => {
    const snap = snapshot();
    snap.states[0].initial = false; // neither state is initial yet
    const { container, client, view } = await setup(snap);
    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    editName(rows[1].nameInput, "->q1");
    await view._lastEditPromise;

    expect(client.docApply).toHaveBeenCalledWith([{ op: "SetInitial", id: 2 }]);
  });

  it("rejects a second -> with a visible error notice, and does not apply SetInitial", async () => {
    const { container, client, view } = await setup();
    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    client.docApply.mockClear();
    editName(rows[1].nameInput, "->q1"); // q0 is already initial
    await view._lastEditPromise;

    expect(client.docApply.mock.calls.some((c) => c[0].some((op) => op.op === "SetInitial"))).toBe(false);
    const notice = document.querySelector(".notice-error");
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain("q0");
  });

  it("removing the -> prefix from the current initial state clears it (SetInitial: null)", async () => {
    const { container, client, view } = await setup();
    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    editName(rows[0].nameInput, "q0"); // was "->q0"
    await view._lastEditPromise;

    expect(client.docApply).toHaveBeenCalledWith([{ op: "SetInitial", id: null }]);
  });

  it("typing * before a name marks that state accepting, and does not require exclusivity", async () => {
    const { container, client, view } = await setup();
    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    editName(rows[0].nameInput, "->*q0"); // q0 initial already; also mark accepting
    await view._lastEditPromise;

    expect(client.docApply).toHaveBeenCalledWith([{ op: "SetAccepting", id: 1, accepting: true }]);
    // q1 (already accepting) is untouched — both may be accepting at once.
    expect(client.docApply).not.toHaveBeenCalledWith([{ op: "SetAccepting", id: 2, accepting: false }]);
  });

  it("removing the * prefix from an accepting state clears it", async () => {
    const { container, client, view } = await setup();
    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    editName(rows[1].nameInput, "q1"); // was "*q1"
    await view._lastEditPromise;

    expect(client.docApply).toHaveBeenCalledWith([{ op: "SetAccepting", id: 2, accepting: false }]);
  });
});

describe("TableView rename", () => {
  it("renames via ctx.renameState, not a raw docStore.apply, when the markers are preserved", async () => {
    const renameState = vi.fn().mockResolvedValue(true);
    const { container, client, view } = await setup(snapshot(), { renameState });
    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    editName(rows[0].nameInput, "->start"); // was "->q0" — keeps initial, renames
    await view._lastEditPromise;

    expect(renameState).toHaveBeenCalledWith(1, "start");
    expect(client.docApply).not.toHaveBeenCalled(); // still initial, no SetInitial call needed
  });

  it("does nothing when neither the name nor the markers changed", async () => {
    const renameState = vi.fn().mockResolvedValue(true);
    const { container, client, view } = await setup(snapshot(), { renameState });
    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    editName(rows[0].nameInput, "->q0"); // unchanged
    await view._lastEditPromise;

    expect(renameState).not.toHaveBeenCalled();
    expect(client.docApply).not.toHaveBeenCalled();
  });

  it("has a Copiar tabla button that copies the table minus the selection column", async () => {
    const { container, view } = await setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const headerCellCount = view.table.rows[0].cells.length;
    const copyButton = [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Copiar tabla");
    expect(copyButton).toBeTruthy();
    copyButton.click();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledTimes(1);
    const headerLine = writeText.mock.calls[0][0].split("\n")[0];
    expect(headerLine.split("\t")).toHaveLength(headerCellCount - 1);
  });
});
