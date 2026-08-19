import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../../store/DocStore.js";
import { ViewContext } from "../../commands/context.js";
import { RegexView } from "./RegexView.js";

function snapshot() {
  return {
    revision: 1,
    states: [{ id: 1, label: "q0", x: 0, y: 0, initial: true, accepting: true }],
    edges: [],
    derived: { classification: "Dfa", alphabet: [], unreachable: [] },
  };
}

async function setup(toRegex = vi.fn().mockResolvedValue("ε"), fromRegex = vi.fn()) {
  const snap = snapshot();
  const client = {
    docSnapshot: vi.fn().mockResolvedValue(snap),
    docApply: vi.fn().mockResolvedValue({ revision: snap.revision + 1, patches: [], derived: snap.derived }),
    docUndo: vi.fn(),
    docRedo: vi.fn(),
  };
  const docStore = new DocStore(client);
  await docStore.load();
  const ctx = new ViewContext(docStore, { toRegex, fromRegex });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new RegexView(container, docStore, ctx);
  await view._lastRefreshPromise;
  return { client, docStore, ctx, container, view };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("RegexView", () => {
  it("renders a .regex-view wrapper with a read-only output", async () => {
    const { container } = await setup();
    const output = container.querySelector(".regex-view .regex-output");
    expect(output).toBeTruthy();
    expect(output.readOnly).toBe(true);
  });

  it("fetches the regex via ctx.toRegex on construction and shows the result", async () => {
    const toRegex = vi.fn().mockResolvedValue("a(b+c)*");
    const { container } = await setup(toRegex);
    expect(toRegex).toHaveBeenCalled();
    expect(container.querySelector(".regex-output").value).toBe("a(b+c)*");
  });

  it("re-fetches whenever the document changes", async () => {
    const toRegex = vi.fn().mockResolvedValueOnce("ε").mockResolvedValueOnce("a*");
    const { container, docStore, view } = await setup(toRegex);
    expect(container.querySelector(".regex-output").value).toBe("ε");

    await docStore.apply([{ op: "AddState", label: "q1", x: 10, y: 10 }]);
    await view._lastRefreshPromise;

    expect(toRegex).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".regex-output").value).toBe("a*");
  });

  it("never lets an out-of-order stale fetch overwrite a newer one", async () => {
    const snap = snapshot();
    const client = {
      docSnapshot: vi.fn().mockResolvedValue(snap),
      docApply: vi.fn().mockResolvedValue({ revision: snap.revision + 1, patches: [], derived: snap.derived }),
      docUndo: vi.fn(),
      docRedo: vi.fn(),
    };
    const docStore = new DocStore(client);
    await docStore.load();

    let resolveFirst;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const toRegex = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce("b*");
    const ctx = new ViewContext(docStore, { toRegex });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const view = new RegexView(container, docStore, ctx);
    // Construction's fetch (token 1) is now in flight, pending on `first`.

    await docStore.apply([{ op: "AddState", label: "q1", x: 10, y: 10 }]);
    await view._lastRefreshPromise; // token 2, resolves "b*" immediately
    expect(container.querySelector(".regex-output").value).toBe("b*");

    // The stale token-1 fetch resolving afterwards must not clobber it.
    resolveFirst("∅");
    await Promise.resolve();
    await Promise.resolve();
    expect(container.querySelector(".regex-output").value).toBe("b*");
  });
});

describe("RegexView generate-from-regex", () => {
  it("renders a text input and a generate button", async () => {
    const { container } = await setup();
    expect(container.querySelector(".regex-input")).toBeTruthy();
    expect(container.querySelector(".regex-error")).toBeTruthy();
  });

  it("calls ctx.fromRegex with the typed pattern on click", async () => {
    const fromRegex = vi.fn().mockResolvedValue({ revision: 2, states: [], edges: [], derived: {} });
    const { container, view } = await setup(undefined, fromRegex);

    container.querySelector(".regex-input").value = "a(b+c)*";
    container.querySelector(".btn-primary").click();
    await view._lastGeneratePromise;

    expect(fromRegex).toHaveBeenCalledWith("a(b+c)*");
  });

  it("shows the rejection message in .regex-error and does not throw when the pattern is invalid", async () => {
    const fromRegex = vi.fn().mockRejectedValue(new Error("'*' inesperado (posición 0)"));
    const { container, view } = await setup(undefined, fromRegex);

    container.querySelector(".regex-input").value = "*a";
    container.querySelector(".btn-primary").click();
    await view._lastGeneratePromise;

    expect(container.querySelector(".regex-error").textContent).toBe("'*' inesperado (posición 0)");
  });

  it("clears a previous error once a later generate call succeeds", async () => {
    const fromRegex = vi
      .fn()
      .mockRejectedValueOnce(new Error("bad"))
      .mockResolvedValueOnce({ revision: 2, states: [], edges: [], derived: {} });
    const { container, view } = await setup(undefined, fromRegex);

    container.querySelector(".regex-input").value = "*a";
    container.querySelector(".btn-primary").click();
    await view._lastGeneratePromise;
    expect(container.querySelector(".regex-error").textContent).toBe("bad");

    container.querySelector(".regex-input").value = "a";
    container.querySelector(".btn-primary").click();
    await view._lastGeneratePromise;
    expect(container.querySelector(".regex-error").textContent).toBe("");
  });
});
