import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../../store/DocStore.js";
import { FormalView } from "./FormalView.js";

function snapshot() {
  return {
    revision: 1,
    states: [
      { id: 1, label: "q0", x: 0, y: 0, initial: true, accepting: false },
      { id: 2, label: "q1", x: 50, y: 0, initial: false, accepting: true },
    ],
    edges: [{ from: 1, to: 2, epsilon: false, symbols: ["a"] }],
    derived: { classification: "Dfa", alphabet: ["a"], unreachable: [] },
  };
}

async function setup() {
  const snap = snapshot();
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
  const view = new FormalView(container, docStore);
  return { client, docStore, container, view };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("FormalView (task 7.5)", () => {
  it("renders into a plain .formal-view wrapper (visibility is the tab group's job, main.js)", async () => {
    const { container } = await setup();
    expect(container.querySelector(".formal-view")).toBeTruthy();
    expect(container.querySelector(".formal-view textarea")).toBeTruthy();
  });

  it("renders the current formal definition in a textarea", async () => {
    const { container } = await setup();
    const textarea = container.querySelector("textarea");
    expect(textarea.value).toContain("Q = {q0, q1}");
    expect(textarea.value).toContain("delta(q0, a) = q1");
  });

  it("shows a validation error and does not mutate the document on an invalid edit", async () => {
    const { container, client } = await setup();
    const textarea = container.querySelector("textarea");
    textarea.value = "Q = {q0}\ndelta(q0, a) = q9"; // q9 undeclared
    container.querySelector("button.apply").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    expect(container.querySelector(".formal-error").textContent).toMatch(/undeclared/i);
    expect(client.docApply).not.toHaveBeenCalled();
  });

  it("applies a valid edit as a sequence of ops against the DocStore", async () => {
    const { container, client, view } = await setup();
    const textarea = container.querySelector("textarea");
    // Same states, but flip which one is accepting.
    textarea.value = ["Q = {q0, q1}", "q0 = q0", "F = {q0}", "delta(q0, a) = q1"].join("\n");
    container.querySelector("button.apply").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await view._lastApplyPromise;

    const allOps = client.docApply.mock.calls.flatMap((c) => c[0]);
    expect(allOps).toEqual(
      expect.arrayContaining([
        { op: "SetAccepting", id: 1, accepting: true },
        { op: "SetAccepting", id: 2, accepting: false },
      ]),
    );
  });

  it("clears a previous error once a subsequent valid edit is applied", async () => {
    const { container, view } = await setup();
    const textarea = container.querySelector("textarea");

    textarea.value = "Q = {q0}\ndelta(q0, a) = q9";
    container.querySelector("button.apply").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(container.querySelector(".formal-error").textContent).not.toBe("");

    textarea.value = ["Q = {q0, q1}", "q0 = q0", "F = {}"].join("\n");
    container.querySelector("button.apply").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await view._lastApplyPromise;

    expect(container.querySelector(".formal-error").textContent).toBe("");
  });

  it("re-renders the textarea when the DocStore changes and the textarea is not focused", async () => {
    const { container, docStore } = await setup();
    docStore.loadSnapshot({
      revision: 2,
      states: [{ id: 5, label: "z0", x: 0, y: 0, initial: true, accepting: false }],
      edges: [],
      derived: { classification: "Dfa", alphabet: [], unreachable: [] },
    });
    expect(container.querySelector("textarea").value).toContain("Q = {z0}");
  });
});
