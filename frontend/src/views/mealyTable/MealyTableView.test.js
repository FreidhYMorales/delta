import { beforeEach, describe, expect, it, vi } from "vitest";
import { MealyDocStore } from "../../store/MealyDocStore.js";
import { MealyContext } from "../../commands/MealyContext.js";
import { MealyTableView } from "./MealyTableView.js";

function snapshot() {
  return {
    revision: 1,
    states: [
      { id: 1, label: "q0", x: 0, y: 0, initial: true },
      { id: 2, label: "q1", x: 50, y: 0, initial: false },
    ],
    edges: [
      { from: 1, to: 1, transitions: [["a", "x"]] },
      { from: 1, to: 2, transitions: [["b", "y"]] },
    ],
    derived: { input_alphabet: ["a", "b"], output_alphabet: ["x", "y"], deterministic: true, unreachable: [] },
  };
}

async function setup(snap = snapshot(), hooks = {}) {
  const client = {
    mealySnapshot: vi.fn().mockResolvedValue(snap),
    mealyApply: vi.fn().mockResolvedValue({ revision: snap.revision + 1, patches: [], derived: snap.derived }),
    mealyUndo: vi.fn(),
    mealyRedo: vi.fn(),
  };
  const docStore = new MealyDocStore(client);
  await docStore.load();
  const ctx = new MealyContext(docStore, hooks);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new MealyTableView(container, docStore, ctx);
  return { client, docStore, ctx, container, view };
}

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

describe("MealyTableView", () => {
  it("renders into a .table-view.mealy-table-view wrapper", async () => {
    const { container } = await setup();
    expect(container.querySelector(".table-view.mealy-table-view")).toBeTruthy();
    expect(container.querySelector("table")).toBeTruthy();
  });

  it("renders one column per input symbol (no epsilon, no accepting column)", async () => {
    const { container } = await setup();
    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["", "Estado", "a", "b"]);
  });

  it("shows the initial state as a -> prefix, no * for anything", async () => {
    const { container } = await setup();
    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    expect(rows[0].nameInput.value).toBe("->q0");
    expect(rows[1].nameInput.value).toBe("q1");
  });

  it("shows target/output pairs in each cell", async () => {
    const { container } = await setup();
    const firstRow = rowControls(container.querySelectorAll("tbody tr")[0]);
    expect(firstRow.cellInputs[0].value).toBe("q0/x");
    expect(firstRow.cellInputs[1].value).toBe("q1/y");
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

describe("MealyTableView editing", () => {
  it("edits a cell as a SetTransitions op with the resolved target id", async () => {
    const { container, client, view } = await setup();
    const firstRow = rowControls(container.querySelectorAll("tbody tr")[0]);
    firstRow.cellInputs[0].value = "q1/z"; // was q0/x (self loop) -> now targets q1
    firstRow.cellInputs[0].dispatchEvent(new Event("change", { bubbles: true }));
    await view._lastEditPromise;

    const setTransitionsCall = client.mealyApply.mock.calls.find((c) =>
      c[0].some((op) => op.op === "SetTransitions" && op.to === 2),
    );
    const toQ1Op = setTransitionsCall[0].find((op) => op.to === 2);
    expect(toQ1Op.entries).toEqual(expect.arrayContaining([["a", "z"], ["b", "y"]]));
  });

  it("auto-creates a not-yet-existing target state typed in a cell", async () => {
    const { container, client, view } = await setup();
    client.mealyApply.mockImplementation(async (ops) => {
      if (ops.some((op) => op.op === "AddState")) {
        return {
          revision: 2,
          patches: [{ patch: "StateAdded", id: 99, label: "q3", x: 0, y: 0 }],
          derived: { input_alphabet: ["a", "b"], output_alphabet: ["x", "y"], deterministic: true, unreachable: [] },
        };
      }
      return { revision: 3, patches: [], derived: { input_alphabet: ["a", "b"], output_alphabet: ["x", "y"], deterministic: true, unreachable: [] } };
    });

    const firstRow = rowControls(container.querySelectorAll("tbody tr")[0]);
    firstRow.cellInputs[1].value = "q3/z";
    firstRow.cellInputs[1].dispatchEvent(new Event("change", { bubbles: true }));
    await view._lastEditPromise;

    const addStateCall = client.mealyApply.mock.calls.find((c) => c[0].some((op) => op.op === "AddState"));
    expect(addStateCall[0]).toEqual([{ op: "AddState", label: "q3", x: expect.any(Number), y: expect.any(Number) }]);
  });
});

describe("MealyTableView add/delete state buttons", () => {
  it("adds a state with the next free label", async () => {
    const { container, client, view } = await setup();
    container.querySelector(".table-buttons-row .btn-secondary:not(.btn-danger)").click();
    await view._lastEditPromise;

    expect(client.mealyApply).toHaveBeenCalledWith([
      { op: "AddState", label: "q2", x: expect.any(Number), y: expect.any(Number) },
    ]);
  });

  it("deletes exactly the checked states", async () => {
    const { container, client, view } = await setup();
    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    rows[1].deleteCheckbox.click();
    container.querySelector(".btn-danger").click();
    await view._lastEditPromise;

    expect(client.mealyApply).toHaveBeenCalledWith([{ op: "RemoveState", id: 2 }]);
  });
});

describe("MealyTableView initial marker (no rejection notice, unlike FA)", () => {
  it("typing -> marks the state initial, silently replacing whoever had it", async () => {
    const { container, client, view } = await setup();
    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    editName(rows[1].nameInput, "->q1"); // q0 was initial
    await view._lastEditPromise;

    expect(client.mealyApply).toHaveBeenCalledWith([{ op: "SetInitial", id: 2 }]);
    expect(document.querySelector(".notice")).toBeNull();
  });

  it("removing -> from the current initial state clears it (SetInitial: null)", async () => {
    const { container, client, view } = await setup();
    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    editName(rows[0].nameInput, "q0");
    await view._lastEditPromise;

    expect(client.mealyApply).toHaveBeenCalledWith([{ op: "SetInitial", id: null }]);
  });
});

describe("MealyTableView rename", () => {
  it("renames via ctx.renameState, not a raw docStore.apply, when -> is preserved", async () => {
    const renameState = vi.fn().mockResolvedValue(true);
    const { container, client, view } = await setup(snapshot(), { renameState });
    const rows = [...container.querySelectorAll("tbody tr")].map(rowControls);
    editName(rows[0].nameInput, "->start");
    await view._lastEditPromise;

    expect(renameState).toHaveBeenCalledWith(1, "start");
    expect(client.mealyApply).not.toHaveBeenCalled();
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
