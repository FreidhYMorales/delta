import { beforeEach, describe, expect, it, vi } from "vitest";
import { MooreDocStore } from "../../store/MooreDocStore.js";
import { MooreContext } from "../../commands/MooreContext.js";
import { MooreTableView } from "./MooreTableView.js";

function snapshot() {
  return {
    revision: 1,
    states: [
      { id: 1, label: "q0", x: 0, y: 0, initial: true, output: "even" },
      { id: 2, label: "q1", x: 50, y: 0, initial: false, output: "odd" },
    ],
    edges: [
      { from: 1, to: 2, inputs: ["a"] },
      { from: 1, to: 1, inputs: ["b"] },
    ],
    derived: { input_alphabet: ["a", "b"], output_alphabet: ["even", "odd"], deterministic: true, unreachable: [] },
  };
}

async function setup(snap = snapshot(), hooks = {}) {
  const client = {
    mooreSnapshot: vi.fn().mockResolvedValue(snap),
    mooreApply: vi.fn().mockResolvedValue({ revision: snap.revision + 1, patches: [], derived: snap.derived }),
    mooreUndo: vi.fn(),
    mooreRedo: vi.fn(),
  };
  const docStore = new MooreDocStore(client);
  await docStore.load();
  const ctx = new MooreContext(docStore, hooks);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new MooreTableView(container, docStore, ctx);
  return { client, docStore, ctx, container, view };
}

function rowControls(tr) {
  return {
    deleteCheckbox: tr.querySelector('td input[type="checkbox"]'),
    nameInput: tr.querySelector(".table-name-input"),
    outputInput: tr.querySelector(".table-output-input"),
    cellInputs: [...tr.querySelectorAll(".table-cell-input")],
  };
}

function editValue(input, value) {
  input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("MooreTableView", () => {
  it("renders into a .table-view.moore-table-view wrapper", async () => {
    const { container } = await setup();
    expect(container.querySelector(".table-view.moore-table-view")).toBeTruthy();
    expect(container.querySelector("table")).toBeTruthy();
  });

  it("renders a Salida column plus one column per input symbol (no epsilon, no accepting column)", async () => {
    const { container } = await setup();
    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["", "Estado", "Salida", "a", "b"]);
  });

  it("shows the initial state as a -> prefix, no * for anything", async () => {
    const { container } = await setup();
    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    expect(rows[0].nameInput.value).toBe("->q0");
    expect(rows[1].nameInput.value).toBe("q1");
  });

  it("shows each state's output in the Salida column", async () => {
    const { container } = await setup();
    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    expect(rows[0].outputInput.value).toBe("even");
    expect(rows[1].outputInput.value).toBe("odd");
  });

  it("shows plain target labels in each cell, no output pairing", async () => {
    const { container } = await setup();
    const firstRow = rowControls(container.querySelectorAll("tbody tr")[0]);
    expect(firstRow.cellInputs[0].value).toBe("q1");
    expect(firstRow.cellInputs[1].value).toBe("q0");
  });

  it("re-renders when the DocStore changes", async () => {
    const { container, docStore } = await setup();
    docStore.loadSnapshot({
      revision: 2,
      states: [],
      edges: [],
      derived: { input_alphabet: [], output_alphabet: [], deterministic: true, unreachable: [] },
    });
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
  });
});

describe("MooreTableView editing", () => {
  it("edits a cell as a SetTransitions op with the resolved target id", async () => {
    const { container, client, view } = await setup();
    const firstRow = rowControls(container.querySelectorAll("tbody tr")[0]);
    editValue(firstRow.cellInputs[0], "q0"); // input "a" was q1, now q0
    await view._lastEditPromise;

    const call = client.mooreApply.mock.calls.find((c) => c[0].some((op) => op.op === "SetTransitions" && op.to === 1));
    expect(call[0]).toEqual(expect.arrayContaining([{ op: "SetTransitions", from: 1, to: 1, inputs: ["b", "a"] }]));
  });

  it("auto-creates a not-yet-existing target state typed in a cell", async () => {
    const { container, client, view } = await setup();
    client.mooreApply.mockImplementation(async (ops) => {
      if (ops.some((op) => op.op === "AddState")) {
        return {
          revision: 2,
          patches: [{ patch: "StateAdded", id: 99, label: "q3", x: 0, y: 0 }],
          derived: { input_alphabet: ["a", "b"], output_alphabet: ["even", "odd"], deterministic: true, unreachable: [] },
        };
      }
      return { revision: 3, patches: [], derived: { input_alphabet: ["a", "b"], output_alphabet: ["even", "odd"], deterministic: true, unreachable: [] } };
    });

    const firstRow = rowControls(container.querySelectorAll("tbody tr")[0]);
    editValue(firstRow.cellInputs[1], "q3");
    await view._lastEditPromise;

    const addStateCall = client.mooreApply.mock.calls.find((c) => c[0].some((op) => op.op === "AddState"));
    expect(addStateCall[0]).toEqual([{ op: "AddState", label: "q3", x: expect.any(Number), y: expect.any(Number) }]);
  });

  it("edits the Salida column as a SetOutput op", async () => {
    const { container, client, view } = await setup();
    const firstRow = rowControls(container.querySelectorAll("tbody tr")[0]);
    editValue(firstRow.outputInput, "zero");
    await view._lastEditPromise;

    expect(client.mooreApply).toHaveBeenCalledWith([{ op: "SetOutput", state: 1, output: "zero" }]);
  });

  it("clearing the Salida column sets output back to null", async () => {
    const { container, client, view } = await setup();
    const firstRow = rowControls(container.querySelectorAll("tbody tr")[0]);
    editValue(firstRow.outputInput, "");
    await view._lastEditPromise;

    expect(client.mooreApply).toHaveBeenCalledWith([{ op: "SetOutput", state: 1, output: null }]);
  });

  it("does not apply anything when the Salida value is unchanged", async () => {
    const { container, client, view } = await setup();
    const firstRow = rowControls(container.querySelectorAll("tbody tr")[0]);
    editValue(firstRow.outputInput, "even");
    await view._lastEditPromise;

    expect(client.mooreApply).not.toHaveBeenCalled();
  });
});

describe("MooreTableView add/delete state buttons", () => {
  it("adds a state with the next free label", async () => {
    const { container, client, view } = await setup();
    container.querySelector(".table-buttons-row .btn-secondary:not(.btn-danger)").click();
    await view._lastEditPromise;

    expect(client.mooreApply).toHaveBeenCalledWith([
      { op: "AddState", label: "q2", x: expect.any(Number), y: expect.any(Number) },
    ]);
  });

  it("deletes exactly the checked states", async () => {
    const { container, client, view } = await setup();
    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    rows[1].deleteCheckbox.click();
    container.querySelector(".btn-danger").click();
    await view._lastEditPromise;

    expect(client.mooreApply).toHaveBeenCalledWith([{ op: "RemoveState", id: 2 }]);
  });
});

describe("MooreTableView initial marker (no rejection notice, unlike FA)", () => {
  it("typing -> marks the state initial, silently replacing whoever had it", async () => {
    const { container, client, view } = await setup();
    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    editValue(rows[1].nameInput, "->q1"); // q0 was initial
    await view._lastEditPromise;

    expect(client.mooreApply).toHaveBeenCalledWith([{ op: "SetInitial", id: 2 }]);
    expect(document.querySelector(".notice")).toBeNull();
  });

  it("removing -> from the current initial state clears it (SetInitial: null)", async () => {
    const { container, client, view } = await setup();
    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    editValue(rows[0].nameInput, "q0");
    await view._lastEditPromise;

    expect(client.mooreApply).toHaveBeenCalledWith([{ op: "SetInitial", id: null }]);
  });
});

describe("MooreTableView rename", () => {
  it("renames via ctx.renameState, not a raw docStore.apply, when -> is preserved", async () => {
    const renameState = vi.fn().mockResolvedValue(true);
    const { container, client, view } = await setup(snapshot(), { renameState });
    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    editValue(rows[0].nameInput, "->start");
    await view._lastEditPromise;

    expect(renameState).toHaveBeenCalledWith(1, "start");
    expect(client.mooreApply).not.toHaveBeenCalled();
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
