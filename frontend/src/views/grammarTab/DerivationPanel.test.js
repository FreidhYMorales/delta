import { beforeEach, describe, expect, it, vi } from "vitest";
import { DerivationPanel } from "./DerivationPanel.js";

const node = (label, kind, children = []) => ({ label, kind, children });

// S -> aS | b, derivation of "ab".
function accepted() {
  return {
    outcome: "accepted",
    reason: null,
    forms: ["S", "aS", "ab"],
    steps: [
      { production: "S → aS", position: 0 },
      { production: "S → b", position: 1 },
    ],
    tree: {
      root: 0,
      nodes: [node("S", "nonterminal", [1, 2]), node("a", "terminal"), node("S", "nonterminal", [3]), node("b", "terminal")],
    },
  };
}

function rejected() {
  return { outcome: "rejected", reason: "la gramática no genera la cadena desde S", forms: [], steps: [], tree: null };
}

function setup(derive = vi.fn().mockResolvedValue(accepted())) {
  const store = { derive };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const panel = new DerivationPanel(container, store);
  return { container, panel, store };
}

async function deriveSingle(container, panel, input = "ab") {
  container.querySelector(".derive-input").value = input;
  container.querySelector(".derive-run").click();
  await panel._lastRunPromise;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("DerivationPanel — one string", () => {
  it("derives the typed string (leftmost by default) and shows the outcome, the steps and the tree", async () => {
    const { container, panel, store } = setup();
    await deriveSingle(container, panel);
    expect(store.derive).toHaveBeenCalledWith("ab", "leftmost");
    expect(container.querySelector(".derive-outcome").textContent).toBe("✓ Aceptada");
    const steps = [...container.querySelectorAll(".derive-steps li")].map((li) => li.textContent);
    expect(steps).toEqual(["S", "⇒ aS  (S → aS)", "⇒ ab  (S → b)"]);
    const svg = container.querySelector("svg.derivation-tree");
    expect(svg.querySelectorAll(".derivation-node")).toHaveLength(4);
    expect(svg.querySelectorAll(".derivation-edge")).toHaveLength(3);
  });

  it("draws a type-0 rule junction as a small dot with the rule as its tooltip, not as a labelled node", async () => {
    const withRule = {
      ...accepted(),
      tree: {
        root: 0,
        nodes: [
          node("S", "nonterminal", [1, 2]),
          node("a", "terminal", [3]),
          node("A", "nonterminal", [3]),
          node("aA → b", "rule", [4]),
          node("b", "terminal"),
        ],
      },
    };
    const { container, panel } = setup(vi.fn().mockResolvedValue(withRule));
    await deriveSingle(container, panel);
    const rule = container.querySelector("svg.derivation-tree .derivation-rule");
    expect(rule.querySelector("text")).toBeNull();
    expect(rule.querySelector("title").textContent).toBe("aA → b");
  });

  it("can derive rightmost", async () => {
    const { container, panel, store } = setup();
    container.querySelector(".derive-order").value = "rightmost";
    await deriveSingle(container, panel);
    expect(store.derive).toHaveBeenCalledWith("ab", "rightmost");
  });

  it("Enter in the input derives too", async () => {
    const { container, panel, store } = setup();
    const input = container.querySelector(".derive-input");
    input.value = "ab";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await panel._lastRunPromise;
    expect(store.derive).toHaveBeenCalledWith("ab", "leftmost");
  });

  it("a rejected string shows why, with no steps or tree", async () => {
    const { container, panel } = setup(vi.fn().mockResolvedValue(rejected()));
    await deriveSingle(container, panel, "ba");
    expect(container.querySelector(".derive-outcome").textContent).toBe("✗ Rechazada");
    expect(container.querySelector(".derive-reason").textContent).toContain("no genera");
    expect(container.querySelectorAll(".derive-steps li")).toHaveLength(0);
    expect(container.querySelector("svg.derivation-tree")).toBeNull();
  });

  it("an invalid grammar shows its error", async () => {
    const { container, panel } = setup(vi.fn().mockRejectedValue("línea 1: falta la flecha '->'"));
    await deriveSingle(container, panel);
    expect(container.querySelector(".derive-reason").textContent).toContain("línea 1");
  });
});

describe("DerivationPanel — batch", () => {
  async function runBatch(container, panel, text) {
    container.querySelector(".batch-input").value = text;
    container.querySelector(".batch-run").click();
    await panel._lastBatchPromise;
  }

  it("tests one string per line and lists each result with its number of steps", async () => {
    const derive = vi.fn(async (input) => (input === "ab" ? accepted() : rejected()));
    const { container, panel } = setup(derive);
    await runBatch(container, panel, "ab\n\nba\n");
    expect(derive.mock.calls.map((c) => c[0])).toEqual(["ab", "ba"]);
    const rows = [...container.querySelectorAll(".batch-table tbody tr")].map((tr) =>
      [...tr.cells].slice(0, 3).map((c) => c.textContent),
    );
    expect(rows).toEqual([
      ["ab", "✓ Aceptada", "2"],
      ["ba", "✗ Rechazada", "—"],
    ]);
    expect(container.querySelector(".batch-section button[title='Copiar tabla']")).toBeTruthy();
  });

  it("each row can open its derivation in the single-string view", async () => {
    const { container, panel, store } = setup();
    await runBatch(container, panel, "ab");
    container.querySelector(".batch-table tbody tr .batch-show").click();
    await panel._lastRunPromise;
    expect(container.querySelector(".derive-input").value).toBe("ab");
    expect(store.derive).toHaveBeenLastCalledWith("ab", "leftmost");
    expect(container.querySelector("svg.derivation-tree")).toBeTruthy();
  });
});
