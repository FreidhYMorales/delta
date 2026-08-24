import { beforeEach, describe, expect, it, vi } from "vitest";
import { TmDocStore } from "../../store/TmDocStore.js";
import { TmFormalView } from "./TmFormalView.js";

function snapshot() {
  return {
    revision: 1,
    states: [
      { id: 1, label: "q0", x: 0, y: 0, initial: true, accepting: false },
      { id: 2, label: "q1", x: 50, y: 0, initial: false, accepting: true },
    ],
    transitions: [{ id: 1, from: 1, to: 2, tapes: [{ read: "a", write: "b", direction: "R" }] }],
    derived: { alphabet: ["a", "b"], tape_count: 1, deterministic: true, unreachable: [] },
  };
}

async function setup() {
  const snap = snapshot();
  const client = {
    tmSnapshot: vi.fn().mockResolvedValue(snap),
    tmApply: vi.fn().mockResolvedValue({ revision: snap.revision + 1, patches: [], derived: snap.derived }),
    tmUndo: vi.fn(),
    tmRedo: vi.fn(),
  };
  const docStore = new TmDocStore(client);
  await docStore.load();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new TmFormalView(container, docStore);
  return { client, docStore, container, view };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("TmFormalView", () => {
  it("renders into a .formal-view.tm-formal-view wrapper", async () => {
    const { container } = await setup();
    expect(container.querySelector(".formal-view.tm-formal-view")).toBeTruthy();
    expect(container.querySelector("textarea")).toBeTruthy();
  });

  it("renders Q/Gamma/q0/F and one delta(from, tapes) = to line per transition", async () => {
    const { container } = await setup();
    const textarea = container.querySelector("textarea");
    expect(textarea.value).toContain("Q = {q0, q1}");
    expect(textarea.value).toContain("F = {q1}");
    expect(textarea.value).toContain("delta(q0, a ; b , R) = q1");
  });

  it("shows a validation error and does not mutate the document on an invalid edit", async () => {
    const { container, client } = await setup();
    const textarea = container.querySelector("textarea");
    textarea.value = "Q = {q0}\ndelta(q0, a ; b , R) = q9"; // q9 undeclared
    container.querySelector("button.apply").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    expect(container.querySelector(".formal-error").textContent).toMatch(/undeclared/i);
    expect(client.tmApply).not.toHaveBeenCalled();
  });

  it("applies a valid edit as a sequence of ops against the DocStore", async () => {
    const { container, client, view } = await setup();
    const textarea = container.querySelector("textarea");
    textarea.value = ["Q = {q0, q1}", "q0 = q1", "F = {q1}", "delta(q0, a ; b , R) = q1"].join("\n");
    container.querySelector("button.apply").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await view._lastApplyPromise;

    const allOps = client.tmApply.mock.calls.flatMap((c) => c[0]);
    expect(allOps).toEqual(expect.arrayContaining([{ op: "SetInitial", id: 2 }]));
  });

  it("adding a second transition between an already-connected pair through formal text keeps both", async () => {
    const { container, client, view } = await setup();
    const textarea = container.querySelector("textarea");
    textarea.value = [
      "Q = {q0, q1}",
      "q0 = q0",
      "F = {q1}",
      "delta(q0, a ; b , R) = q1",
      "delta(q0, c ; d , L) = q1",
    ].join("\n");
    container.querySelector("button.apply").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await view._lastApplyPromise;

    const allOps = client.tmApply.mock.calls.flatMap((c) => c[0]);
    expect(allOps).toEqual(
      expect.arrayContaining([
        { op: "AddTransition", from: 1, to: 2, tapes: [{ read: "c", write: "d", direction: "L" }] },
      ]),
    );
    expect(allOps.some((op) => op.op === "RemoveTransition")).toBe(false);
  });

  it("re-renders the textarea when the DocStore changes and the textarea is not focused", async () => {
    const { container, docStore } = await setup();
    docStore.loadSnapshot({
      revision: 2,
      states: [{ id: 5, label: "z0", x: 0, y: 0, initial: true, accepting: false }],
      transitions: [],
      derived: { alphabet: [], tape_count: 0, deterministic: true, unreachable: [] },
    });
    expect(container.querySelector("textarea").value).toContain("Q = {z0}");
  });
});
