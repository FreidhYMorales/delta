import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../../store/DocStore.js";
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

async function setup(snap = snapshot()) {
  const client = {
    docSnapshot: vi.fn().mockResolvedValue(snap),
    docApply: vi.fn().mockResolvedValue({ revision: snap.revision + 1, patches: [], derived: snap.derived }),
    docUndo: vi.fn(),
    docRedo: vi.fn(),
  };
  const docStore = new DocStore(client);
  await docStore.load();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new TableView(container, docStore);
  return { client, docStore, container, view };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("TableView (task 7.5)", () => {
  it("is collapsed by default", async () => {
    const { container } = await setup();
    const details = container.querySelector("details.table-view");
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);
  });

  it("renders one column per alphabet symbol plus a fixed epsilon column, and one row per state", async () => {
    const { container } = await setup();
    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["", "a", "b", "ε"]);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
  });

  it("marks the initial and accepting rows with → and *", async () => {
    const { container } = await setup();
    const rowHeaders = [...container.querySelectorAll("tbody th")].map((th) => th.textContent);
    expect(rowHeaders).toEqual(["→ q0", "* q1"]);
  });

  it("shows existing destinations in each cell", async () => {
    const { container } = await setup();
    const firstRow = container.querySelectorAll("tbody tr")[0];
    const cellInputs = firstRow.querySelectorAll("input");
    expect(cellInputs[0].value).toBe("q0"); // column a: self loop
    expect(cellInputs[1].value).toBe("q1"); // column b
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
    const firstRow = container.querySelectorAll("tbody tr")[0]; // q0
    const cellB = firstRow.querySelectorAll("input")[1]; // column b, currently "q1"
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

    const firstRow = container.querySelectorAll("tbody tr")[0]; // q0
    const cellB = firstRow.querySelectorAll("input")[1];
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
