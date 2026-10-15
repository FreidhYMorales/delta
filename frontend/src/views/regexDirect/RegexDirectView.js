// "ER → AFD" tab: regex -> DFA by the direct method, shown step by step the
// way the course worksheet works it (`idea/nuevos_agregados/ER a AFD.pdf`):
// the syntax tree augmented with `#`, numbered leaves, nullable/PrimeraPos/
// ÚltimaPos per node, SiguientePos, the D states and the D transitions.
// The core computes everything (`ctx.regexToDfaDirect`,
// `conv_regex_to_dfa_direct`); this view only formats and draws it. Unlike
// the other panel tabs it does not read the current automaton — it works
// from the regex typed here — and the resulting DFA opens in a new tab.

import { createCopyTableButton } from "../../ui/copyTable.js";
import { buildDirectTables, layoutSyntaxTree } from "./regexDirectLogic.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_RADIUS = 15;
const LEVEL_SPACING = 70;
const SET_CHAR_WIDTH = 6.5; // estimate for the 11px set labels
const MARGIN = 24;

const TABLE_STEPS = [
  { key: "leaves", title: "Paso 2: hojas numeradas y anulables" },
  { key: "nodes", title: "Paso 3-4: anulable, PrimeraPos y ÚltimaPos por nodo" },
  { key: "followpos", title: "Paso 5: SiguientePos" },
  { key: "states", title: "Paso 6: estados D" },
  { key: "transitions", title: "Paso 7: transiciones D" },
];

export class RegexDirectView {
  /**
   * @param {HTMLElement} container
   * @param {{regexToDfaDirect: (pattern: string) => Promise<object>, createDfaTab: (model: object) => Promise<void>}} ctx
   */
  constructor(container, ctx) {
    this.ctx = ctx;
    this._dfa = null;
    this._build(container);
  }

  _build(container) {
    this.root = document.createElement("div");
    this.root.className = "table-view conversion-view regex-direct-view";

    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = "Expresión regular";

    const row = document.createElement("div");
    row.className = "regex-direct-row";
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "string-input regex-direct-input";
    this.input.placeholder = "p.ej. (a|b)*abb";
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this._lastRunPromise = this._run();
    });
    const runButton = document.createElement("button");
    runButton.type = "button";
    runButton.className = "btn-primary regex-direct-run";
    runButton.textContent = "Calcular";
    runButton.addEventListener("click", () => {
      this._lastRunPromise = this._run();
    });
    row.append(this.input, runButton);

    const hint = document.createElement("p");
    hint.className = "regex-syntax-hint";
    hint.textContent = "| unión · * cero o más · + una o más · ? opcional · ε vacía — # es el marcador final";

    this.error = document.createElement("div");
    this.error.className = "regex-error regex-direct-error";

    this.steps = document.createElement("div");
    this.steps.className = "regex-direct-steps";

    this.note = document.createElement("p");
    this.note.className = "conversion-note";
    this.note.textContent =
      "Estado inicial: PrimeraPos de la raíz. Estados de aceptación (*): los que contienen la posición de #.";

    this.createButton = document.createElement("button");
    this.createButton.type = "button";
    this.createButton.className = "btn-secondary conversion-create";
    this.createButton.textContent = "Crear AFD en nueva pestaña";
    this.createButton.disabled = true;
    this.createButton.addEventListener("click", () => {
      if (this._dfa) this._lastCreatePromise = this.ctx.createDfaTab(this._dfa);
    });

    this.root.append(label, row, hint, this.error, this.steps, this.note, this.createButton);
    container.appendChild(this.root);
  }

  async _run() {
    this.error.textContent = "";
    try {
      const result = await this.ctx.regexToDfaDirect(this.input.value);
      this._show(result);
    } catch (error) {
      this._dfa = null;
      this.createButton.disabled = true;
      this.steps.replaceChildren();
      this.error.textContent = String(error?.message ?? error);
    }
  }

  _show(result) {
    const tables = buildDirectTables(result);
    const legend = document.createElement("p");
    legend.className = "conversion-note";
    legend.textContent =
      "PrimeraPos a la izquierda de cada nodo, ÚltimaPos a la derecha, número de posición debajo de cada hoja; borde punteado = anulable.";
    const tree = document.createElement("div");
    tree.append(drawTree(result), legend);
    const sections = [section("Paso 1: árbol sintáctico aumentado con #", tree)];
    for (const step of TABLE_STEPS) {
      const table = document.createElement("table");
      fillTable(table, tables[step.key]);
      sections.push(section(step.title, table, createCopyTableButton(() => table)));
    }
    this.steps.replaceChildren(...sections);
    this._dfa = tables.dfa;
    this.createButton.disabled = false;
  }
}

function section(title, body, action) {
  const el = document.createElement("section");
  el.className = "conversion-step";
  const header = document.createElement("div");
  header.className = "conversion-step-header";
  const h3 = document.createElement("h3");
  h3.textContent = title;
  header.append(h3, ...(action ? [action] : []));
  el.append(header, body);
  return el;
}

/** The augmented syntax tree as SVG: each node with its label, its
 * PrimeraPos on the left and ÚltimaPos on the right (as in the textbook
 * figure), and each leaf's position number underneath. */
function drawTree({ nodes, root }) {
  const setText = (s) => `{${s.join(",")}}`;
  const widest = Math.max(...nodes.flatMap((n) => [setText(n.firstpos).length, setText(n.lastpos).length]));
  // Room for one node's right label and its neighbor's left label.
  const leafSpacing = Math.max(70, 2 * (NODE_RADIUS + 6 + widest * SET_CHAR_WIDTH));
  const at = layoutSyntaxTree(nodes, root, { leafSpacing, levelSpacing: LEVEL_SPACING });

  const side = NODE_RADIUS + 6 + widest * SET_CHAR_WIDTH;
  const xs = at.map((p) => p.x);
  const ys = at.map((p) => p.y);
  const minX = Math.min(...xs) - side - MARGIN;
  const width = Math.max(...xs) + side + MARGIN - minX;
  const minY = -NODE_RADIUS - MARGIN;
  const height = Math.max(...ys) + NODE_RADIUS + 20 + MARGIN - minY;

  const svg = svgEl("svg", {
    class: "syntax-tree",
    viewBox: `${minX} ${minY} ${width} ${height}`,
    width,
    height,
    role: "img",
    "aria-label": "Árbol sintáctico aumentado",
  });
  nodes.forEach((node, i) => {
    for (const child of node.children) {
      svg.appendChild(svgEl("line", { class: "tree-edge", x1: at[i].x, y1: at[i].y, x2: at[child].x, y2: at[child].y }));
    }
  });
  nodes.forEach((node, i) => {
    const { x, y } = at[i];
    const g = svgEl("g", { class: `tree-node${node.nullable ? " tree-node-nullable" : ""}` });
    g.appendChild(svgEl("circle", { cx: x, cy: y, r: NODE_RADIUS }));
    g.appendChild(text(node.label, { x, y: y + 5, class: "tree-label" }));
    g.appendChild(text(setText(node.firstpos), { x: x - NODE_RADIUS - 5, y: y + 4, class: "tree-set", "text-anchor": "end" }));
    g.appendChild(text(setText(node.lastpos), { x: x + NODE_RADIUS + 5, y: y + 4, class: "tree-set", "text-anchor": "start" }));
    if (node.position != null) {
      g.appendChild(text(String(node.position), { x, y: y + NODE_RADIUS + 15, class: "tree-position" }));
    }
    svg.appendChild(g);
  });
  return svg;
}

function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function text(content, attrs) {
  const el = svgEl("text", { "text-anchor": "middle", ...attrs });
  el.textContent = content;
  return el;
}

/** @param {HTMLTableElement} table @param {{headers:string[], rows:string[][]}} data */
function fillTable(table, { headers, rows }) {
  const thead = document.createElement("thead");
  const headRow = thead.insertRow();
  for (const value of headers) {
    const th = document.createElement("th");
    th.textContent = value;
    headRow.appendChild(th);
  }
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = tbody.insertRow();
    row.forEach((value, i) => {
      const cell = document.createElement(i === 0 ? "th" : "td");
      cell.textContent = value;
      tr.appendChild(cell);
    });
  }
  table.replaceChildren(thead, tbody);
}
