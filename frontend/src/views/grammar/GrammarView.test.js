import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../../store/DocStore.js";
import { ViewContext } from "../../commands/context.js";
import { GrammarView } from "./GrammarView.js";

function snapshot() {
  return {
    revision: 1,
    states: [{ id: 1, label: "q0", x: 0, y: 0, initial: true, accepting: true }],
    edges: [],
    derived: { classification: "Dfa", alphabet: [], unreachable: [] },
  };
}

async function setup(toGrammar = vi.fn().mockResolvedValue("q0 -> ε\n"), fromGrammar = vi.fn()) {
  const snap = snapshot();
  const client = {
    docSnapshot: vi.fn().mockResolvedValue(snap),
    docApply: vi.fn().mockResolvedValue({ revision: snap.revision + 1, patches: [], derived: snap.derived }),
    docUndo: vi.fn(),
    docRedo: vi.fn(),
  };
  const docStore = new DocStore(client);
  await docStore.load();
  const ctx = new ViewContext(docStore, { toGrammar, fromGrammar });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new GrammarView(container, docStore, ctx);
  await view._lastRefreshPromise;
  return { client, docStore, ctx, container, view };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("GrammarView", () => {
  it("renders a .grammar-view wrapper with a read-only output", async () => {
    const { container } = await setup();
    const output = container.querySelector(".grammar-view .grammar-output");
    expect(output).toBeTruthy();
    expect(output.readOnly).toBe(true);
  });

  it("fetches the grammar via ctx.toGrammar on construction and shows the result", async () => {
    const toGrammar = vi.fn().mockResolvedValue("q0 -> a q1\nq1 -> ε\n");
    const { container } = await setup(toGrammar);
    expect(toGrammar).toHaveBeenCalled();
    expect(container.querySelector(".grammar-output").value).toBe("q0 -> a q1\nq1 -> ε\n");
  });

  it("re-fetches whenever the document changes", async () => {
    const toGrammar = vi.fn().mockResolvedValueOnce("q0 -> ε\n").mockResolvedValueOnce("q0 -> a q0\n");
    const { container, docStore, view } = await setup(toGrammar);
    expect(container.querySelector(".grammar-output").value).toBe("q0 -> ε\n");

    await docStore.apply([{ op: "AddState", label: "q1", x: 10, y: 10 }]);
    await view._lastRefreshPromise;

    expect(toGrammar).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".grammar-output").value).toBe("q0 -> a q0\n");
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
    const toGrammar = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce("q0 -> b q0\n");
    const ctx = new ViewContext(docStore, { toGrammar });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const view = new GrammarView(container, docStore, ctx);
    // Construction's fetch (token 1) is now in flight, pending on `first`.

    await docStore.apply([{ op: "AddState", label: "q1", x: 10, y: 10 }]);
    await view._lastRefreshPromise; // token 2, resolves immediately
    expect(container.querySelector(".grammar-output").value).toBe("q0 -> b q0\n");

    // The stale token-1 fetch resolving afterwards must not clobber it.
    resolveFirst("");
    await Promise.resolve();
    await Promise.resolve();
    expect(container.querySelector(".grammar-output").value).toBe("q0 -> b q0\n");
  });
});

describe("GrammarView generate-from-grammar", () => {
  it("renders a multi-line text input and a generate button", async () => {
    const { container } = await setup();
    const input = container.querySelector(".grammar-input");
    expect(input).toBeTruthy();
    expect(input.tagName).toBe("TEXTAREA");
    expect(container.querySelector(".grammar-error")).toBeTruthy();
  });

  it("calls ctx.fromGrammar with the typed text on click", async () => {
    const fromGrammar = vi.fn().mockResolvedValue({ revision: 2, states: [], edges: [], derived: {} });
    const { container, view } = await setup(undefined, fromGrammar);

    container.querySelector(".grammar-input").value = "q0 -> a q1\nq1 -> ε";
    container.querySelector(".btn-primary").click();
    await view._lastGeneratePromise;

    expect(fromGrammar).toHaveBeenCalledWith("q0 -> a q1\nq1 -> ε");
  });

  it("shows the rejection message in .grammar-error and does not throw when the text is invalid", async () => {
    const fromGrammar = vi.fn().mockRejectedValue(new Error("falta '->' en la producción (línea 1)"));
    const { container, view } = await setup(undefined, fromGrammar);

    container.querySelector(".grammar-input").value = "q0 q1";
    container.querySelector(".btn-primary").click();
    await view._lastGeneratePromise;

    expect(container.querySelector(".grammar-error").textContent).toBe(
      "falta '->' en la producción (línea 1)",
    );
  });

  it("clears a previous error once a later generate call succeeds", async () => {
    const fromGrammar = vi
      .fn()
      .mockRejectedValueOnce(new Error("bad"))
      .mockResolvedValueOnce({ revision: 2, states: [], edges: [], derived: {} });
    const { container, view } = await setup(undefined, fromGrammar);

    container.querySelector(".grammar-input").value = "q0 q1";
    container.querySelector(".btn-primary").click();
    await view._lastGeneratePromise;
    expect(container.querySelector(".grammar-error").textContent).toBe("bad");

    container.querySelector(".grammar-input").value = "q0 -> ε";
    container.querySelector(".btn-primary").click();
    await view._lastGeneratePromise;
    expect(container.querySelector(".grammar-error").textContent).toBe("");
  });
});
