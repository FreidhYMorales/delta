// "Probar cadenas" panel of the "Gramática" tab: derive one string (the
// derivation step by step and its derivation tree) or test a batch of
// strings at once (a results table; any row opens its derivation). The
// core decides membership and builds the derivation (`store.derive`,
// `grammar_derive`); this panel only shows it.

import { createCopyTableButton } from "../../ui/copyTable.js";
import { derivationText, layoutDerivationTree, outcomeLabel, parseBatch } from "./derivationLogic.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_RADIUS = 13;
const LEVEL_SPACING = 56;
const CHAR_WIDTH = 8; // estimate for the 13px node labels
const MARGIN = 20;

export class DerivationPanel {
  /**
   * @param {HTMLElement} container
   * @param {{derive: (input: string, order: string, start: string|null) => Promise<object>}} store
   * @param {{beforeDerive?: () => Promise<unknown>}} [options] `beforeDerive`
   *   runs (and is awaited) before every derivation — the tab uses it to send
   *   any edit still waiting on its typing pause.
   */
  constructor(container, store, { beforeDerive } = {}) {
    this.store = store;
    this.beforeDerive = beforeDerive ?? (async () => {});
    /** @type {"productions"|"bnf"} how the derivation is written */
    this.notation = "productions";
    this._build(container);
  }

  /** @param {"productions"|"bnf"} notation */
  setNotation(notation) {
    this.notation = notation;
  }

  _build(container) {
    this.root = document.createElement("section");
    this.root.className = "derivation-panel";

    const title = document.createElement("h3");
    title.textContent = "Probar cadenas";

    const row = document.createElement("div");
    row.className = "derive-row";
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "string-input derive-input";
    this.input.placeholder = "Cadena, p. ej. aab (ε = vacía)";
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this._lastRunPromise = this._run();
    });
    this.order = document.createElement("select");
    this.order.className = "derive-order";
    for (const [value, label] of [
      ["leftmost", "Derivación por la izquierda"],
      ["rightmost", "Derivación por la derecha"],
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      this.order.appendChild(option);
    }
    const runButton = document.createElement("button");
    runButton.type = "button";
    runButton.className = "btn-primary derive-run";
    runButton.textContent = "Derivar";
    runButton.addEventListener("click", () => {
      this._lastRunPromise = this._run();
    });
    // Which non-terminal to derive from: the grammar's start symbol by
    // default, or any other (a BNF text defines many rules worth testing on
    // their own). Filled by `setNonterminals`.
    this.start = document.createElement("select");
    this.start.className = "derive-start";
    this.start.title = "Derivar desde";
    this.setNonterminals([]);
    row.append(this.input, this.start, this.order, runButton);

    this.outcome = document.createElement("p");
    this.outcome.className = "derive-outcome";
    this.reason = document.createElement("p");
    this.reason.className = "derive-reason";
    this.steps = document.createElement("ol");
    this.steps.className = "derive-steps";
    this.treeHost = document.createElement("div");
    this.treeHost.className = "derive-tree-host";

    const batch = document.createElement("div");
    batch.className = "batch-section";
    const batchHeader = document.createElement("div");
    batchHeader.className = "conversion-step-header";
    const batchTitle = document.createElement("h4");
    batchTitle.textContent = "Prueba en lote";
    this.batchTable = document.createElement("table");
    this.batchTable.className = "batch-table";
    batchHeader.append(batchTitle, createCopyTableButton(() => this.batchTable, { skipClass: "batch-actions" }));
    this.batchInput = document.createElement("textarea");
    this.batchInput.className = "batch-input";
    this.batchInput.placeholder = "Una cadena por línea";
    this.batchInput.rows = 5;
    const batchButton = document.createElement("button");
    batchButton.type = "button";
    batchButton.className = "btn-secondary batch-run";
    batchButton.textContent = "Probar lote";
    batchButton.addEventListener("click", () => {
      this._lastBatchPromise = this._runBatch();
    });
    batch.append(batchHeader, this.batchInput, batchButton, this.batchTable);

    this.root.append(title, row, this.outcome, this.reason, this.steps, this.treeHost, batch);
    container.appendChild(this.root);
  }

  /** @param {string[]} nonterminals the current grammar's, in order */
  setNonterminals(nonterminals) {
    const chosen = this.start.value;
    const initial = document.createElement("option");
    initial.value = "";
    initial.textContent = "Desde el símbolo inicial";
    const options = nonterminals.map((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = `Desde ${name}`;
      return option;
    });
    this.start.replaceChildren(initial, ...options);
    this.start.value = nonterminals.includes(chosen) ? chosen : "";
  }

  _startSymbol() {
    return this.start.value || null;
  }

  async _run() {
    this._clearResult();
    try {
      await this.beforeDerive();
      const derivation = await this.store.derive(this.input.value, this.order.value, this._startSymbol());
      this._show(derivation);
    } catch (error) {
      this.reason.textContent = String(error?.message ?? error);
    }
  }

  _clearResult() {
    this.outcome.textContent = "";
    this.reason.textContent = "";
    this.steps.replaceChildren();
    this.treeHost.replaceChildren();
  }

  _show(derivation) {
    this.outcome.textContent = outcomeLabel(derivation.outcome);
    this.outcome.dataset.outcome = derivation.outcome;
    this.reason.textContent = derivation.reason ?? "";
    for (const line of this._derivationLines(derivation)) {
      const li = document.createElement("li");
      const form = document.createElement("span");
      form.className = "derive-form";
      form.textContent = line.form;
      li.appendChild(form);
      if (line.rule) {
        const rule = document.createElement("span");
        rule.className = "derive-rule";
        rule.textContent = line.rule;
        li.appendChild(rule);
      }
      this.steps.appendChild(li);
    }
    if (derivation.tree) {
      this.steps.title = derivationText(derivation);
      this.treeHost.appendChild(drawDerivationTree(derivation.tree));
    }
  }

  /** One line per step, as the course writes it: in BNF the start symbol
   * and the first step share a line (`<entero> ::= <digito><entero>`) and
   * every next one starts with `::=`; with productions each step is `⇒ …`.
   * Each line notes the rule it applied. */
  _derivationLines({ forms, steps }) {
    if (!forms.length) return [];
    if (this.notation === "bnf" && steps.length) {
      return steps.map((step, i) => ({
        form: i === 0 ? `${forms[0]} ::= ${step.form}` : `::= ${step.form}`,
        rule: step.production,
      }));
    }
    return [{ form: forms[0], rule: null }, ...steps.map((step) => ({ form: `⇒ ${step.form}`, rule: step.production }))];
  }

  async _runBatch() {
    await this.beforeDerive();
    const inputs = parseBatch(this.batchInput.value);
    const results = [];
    for (const input of inputs) {
      try {
        results.push({ input, derivation: await this.store.derive(input, this.order.value, this._startSymbol()) });
      } catch (error) {
        results.push({ input, error: String(error?.message ?? error) });
      }
    }
    this._renderBatch(results);
  }

  _renderBatch(results) {
    const thead = document.createElement("thead");
    const head = thead.insertRow();
    for (const title of ["Cadena", "Resultado", "Pasos"]) {
      const th = document.createElement("th");
      th.textContent = title;
      head.appendChild(th);
    }
    const actionsHead = document.createElement("th");
    actionsHead.className = "batch-actions";
    head.appendChild(actionsHead);

    const tbody = document.createElement("tbody");
    for (const { input, derivation, error } of results) {
      const tr = tbody.insertRow();
      tr.insertCell().textContent = input;
      tr.insertCell().textContent = derivation ? outcomeLabel(derivation.outcome) : error;
      tr.insertCell().textContent = derivation?.outcome === "accepted" ? String(derivation.steps.length) : "—";
      const actions = tr.insertCell();
      actions.className = "batch-actions";
      const show = document.createElement("button");
      show.type = "button";
      show.className = "btn-secondary batch-show";
      show.textContent = "Ver derivación";
      show.addEventListener("click", () => {
        this.input.value = input;
        this._lastRunPromise = this._run();
      });
      actions.appendChild(show);
    }
    this.batchTable.replaceChildren(thead, tbody);
  }
}

/** The derivation tree (a graph for multi-symbol rewrites) as SVG. */
function drawDerivationTree(tree) {
  const labelled = tree.nodes.filter((n) => n.kind !== "rule");
  const widest = Math.max(...labelled.map((n) => [...n.label].length));
  const leafSpacing = Math.max(44, widest * CHAR_WIDTH + 18);
  const at = layoutDerivationTree(tree, { leafSpacing, levelSpacing: LEVEL_SPACING });
  const xs = at.map((p) => p.x);
  const ys = at.map((p) => p.y);
  const half = Math.max(NODE_RADIUS, (widest * CHAR_WIDTH) / 2);
  const minX = Math.min(...xs) - half - MARGIN;
  const width = Math.max(...xs) + half + MARGIN - minX;
  const minY = -NODE_RADIUS - MARGIN;
  const height = Math.max(...ys) + NODE_RADIUS + MARGIN - minY;

  const svg = svgEl("svg", {
    class: "derivation-tree",
    viewBox: `${minX} ${minY} ${width} ${height}`,
    width,
    height,
    role: "img",
    "aria-label": "Árbol de derivación",
  });
  tree.nodes.forEach((node, i) => {
    for (const child of node.children) {
      svg.appendChild(svgEl("line", { class: "derivation-edge", x1: at[i].x, y1: at[i].y, x2: at[child].x, y2: at[child].y }));
    }
  });
  tree.nodes.forEach((node, i) => {
    if (node.kind === "rule") {
      // A type-0 rewrite of several symbols: a junction dot, the rule as
      // its tooltip.
      const g = svgEl("g", { class: "derivation-rule" });
      const title = svgEl("title", {});
      title.textContent = node.label;
      g.append(title, svgEl("circle", { cx: at[i].x, cy: at[i].y, r: 4 }));
      svg.appendChild(g);
      return;
    }
    // A box per symbol, as the course draws it; leaves are marked by CSS.
    const g = svgEl("g", { class: `derivation-node derivation-${node.kind}` });
    const width = Math.max(2 * NODE_RADIUS, [...node.label].length * CHAR_WIDTH + 14);
    g.appendChild(
      svgEl("rect", { x: at[i].x - width / 2, y: at[i].y - NODE_RADIUS, width, height: 2 * NODE_RADIUS, rx: 3 }),
    );
    const text = svgEl("text", { x: at[i].x, y: at[i].y + 5, "text-anchor": "middle" });
    text.textContent = node.label;
    g.appendChild(text);
    svg.appendChild(g);
  });
  return svg;
}

function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}
