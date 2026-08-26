import { beforeEach, describe, expect, it, vi } from "vitest";
import { MealyDocStore } from "../../store/MealyDocStore.js";
import { MealyFormalView } from "./MealyFormalView.js";

function snapshot() {
  return {
    revision: 1,
    states: [
      { id: 1, label: "q0", x: 0, y: 0, initial: true },
      { id: 2, label: "q1", x: 50, y: 0, initial: false },
    ],
    edges: [{ from: 1, to: 2, transitions: [["a", "x"]] }],
    derived: { input_alphabet: ["a"], output_alphabet: ["x"], deterministic: true, unreachable: [] },
  };
}

async function setup() {
  const snap = snapshot();
  const client = {
    mealySnapshot: vi.fn().mockResolvedValue(snap),
    mealyApply: vi.fn().mockResolvedValue({ revision: snap.revision + 1, patches: [], derived: snap.derived }),
    mealyUndo: vi.fn(),
    mealyRedo: vi.fn(),
  };
  const docStore = new MealyDocStore(client);
  await docStore.load();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new MealyFormalView(container, docStore);
  return { client, docStore, container, view };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("MealyFormalView", () => {
  it("renders into a .formal-view.mealy-formal-view wrapper", async () => {
    const { container } = await setup();
    expect(container.querySelector(".formal-view.mealy-formal-view")).toBeTruthy();
    expect(container.querySelector("textarea")).toBeTruthy();
  });

  it("renders the current formal definition, no F line", async () => {
    const { container } = await setup();
    const textarea = container.querySelector("textarea");
    expect(textarea.value).toContain("Q = {q0, q1}");
    expect(textarea.value).toContain("δ(q0, a) = q1/x");
    expect(textarea.value).not.toContain("F =");
  });

  it("shows a validation error and does not mutate the document on an invalid edit", async () => {
    const { container, client } = await setup();
    const textarea = container.querySelector("textarea");
    textarea.value = "Q = {q0}\ndelta(q0, a) = q9/x"; // q9 undeclared
    container.querySelector("button.apply").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    expect(container.querySelector(".formal-error").textContent).toMatch(/undeclared/i);
    expect(client.mealyApply).not.toHaveBeenCalled();
  });

  it("applies a valid edit as a sequence of ops against the DocStore", async () => {
    const { container, client, view } = await setup();
    const textarea = container.querySelector("textarea");
    textarea.value = ["Q = {q0, q1}", "q0 = q1", "delta(q0, a) = q1/x"].join("\n");
    container.querySelector("button.apply").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await view._lastApplyPromise;

    const allOps = client.mealyApply.mock.calls.flatMap((c) => c[0]);
    expect(allOps).toEqual(expect.arrayContaining([{ op: "SetInitial", id: 2 }]));
  });

  it("clears a previous error once a subsequent valid edit is applied", async () => {
    const { container, view } = await setup();
    const textarea = container.querySelector("textarea");

    textarea.value = "Q = {q0}\ndelta(q0, a) = q9/x";
    container.querySelector("button.apply").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(container.querySelector(".formal-error").textContent).not.toBe("");

    textarea.value = ["Q = {q0, q1}", "q0 = q0"].join("\n");
    container.querySelector("button.apply").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await view._lastApplyPromise;

    expect(container.querySelector(".formal-error").textContent).toBe("");
  });

  it("re-renders the textarea when the DocStore changes and the textarea is not focused", async () => {
    const { container, docStore } = await setup();
    docStore.loadSnapshot({
      revision: 2,
      states: [{ id: 5, label: "z0", x: 0, y: 0, initial: true }],
      edges: [],
      derived: { input_alphabet: [], output_alphabet: [], deterministic: true, unreachable: [] },
    });
    expect(container.querySelector("textarea").value).toContain("Q = {z0}");
  });
});
