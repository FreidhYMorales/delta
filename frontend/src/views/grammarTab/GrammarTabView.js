// "Gramática" tab: a grammar editor plus what the core derives from it —
// the formal definition G = {Σ, N, S, P}, its type in the Chomsky
// hierarchy with the reason for each level, the course's hierarchy table
// with the grammar's row highlighted, and string testing (`DerivationPanel`:
// derivations and derivation trees, one string or a batch). The text box is the source of
// truth while typing; each pause sends it to the core (`store.setSource`).

import { DerivationPanel } from "./DerivationPanel.js";
import { CHOMSKY_TABLE, formalDefinition, grammarTypeName } from "./grammarTabLogic.js";

const SEND_DELAY_MS = 300;
const PLACEHOLDER = "S -> aS | aA\nA -> bA | b";
const SYNTAX_HINT =
  "Una producción por línea: -> o → · | alternativas · ε (o λ, ∈) vacío · mayúsculas o <nombre> son no terminales · " +
  "'palabra' es un terminal de varias letras · opcional: Σ = {a, b}, N = {S, A}, S = S";

export class GrammarTabView {
  /**
   * @param {HTMLElement} container
   * @param {import('../../store/GrammarDocStore.js').GrammarDocStore} store
   */
  constructor(container, store) {
    this.store = store;
    // Once the user types, the text box owns the text: a snapshot arriving
    // for an older keystroke must never overwrite newer typing.
    this._edited = false;
    this._timer = null;
    this._build(container);
    store.subscribe(() => this._render());
    this._render();
  }

  _build(container) {
    this.root = document.createElement("div");
    this.root.className = "grammar-tab";

    const editorPane = document.createElement("div");
    editorPane.className = "grammar-editor-pane";
    const editorLabel = document.createElement("label");
    editorLabel.className = "field-label";
    editorLabel.textContent = "Gramática G = {Σ, N, S, P}";
    this.editor = document.createElement("textarea");
    this.editor.className = "grammar-source";
    this.editor.spellcheck = false;
    this.editor.placeholder = PLACEHOLDER;
    this.editor.addEventListener("input", () => this._onInput());
    const hint = document.createElement("p");
    hint.className = "grammar-hint";
    hint.textContent = SYNTAX_HINT;
    this.error = document.createElement("div");
    this.error.className = "grammar-error";
    this.warnings = document.createElement("ul");
    this.warnings.className = "grammar-warnings";
    editorPane.append(editorLabel, this.editor, hint, this.error, this.warnings);

    const analysisPane = document.createElement("div");
    analysisPane.className = "grammar-analysis-pane";
    this.definition = section(analysisPane, "Definición formal", "grammar-definition");
    this.classification = section(analysisPane, "Jerarquía de Chomsky", "grammar-classification");
    this.table = document.createElement("table");
    this.table.className = "chomsky-table";
    analysisPane.appendChild(this.table);

    const derivations = document.createElement("div");
    derivations.className = "grammar-derivations";
    new DerivationPanel(derivations, this.store);

    this.root.append(editorPane, analysisPane, derivations);
    container.appendChild(this.root);
  }

  _onInput() {
    this._edited = true;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._lastSendPromise = this.store.setSource(this.editor.value);
    }, SEND_DELAY_MS);
  }

  _render() {
    if (!this._edited) this.editor.value = this.store.source;
    const analysis = this.store.analysis ?? { grammar: null, classification: null, error: null };

    this.error.textContent = analysis.error ? `Línea ${analysis.error.line}: ${analysis.error.message}` : "";
    this.warnings.replaceChildren(
      ...(analysis.grammar?.warnings ?? []).map((w) => {
        const li = document.createElement("li");
        li.textContent = w;
        return li;
      }),
    );

    this.definition.replaceChildren();
    if (analysis.grammar) {
      const def = formalDefinition(analysis.grammar);
      const lines = [def.sigma, def.n, def.s, "P:"];
      for (const text of lines) this.definition.appendChild(line(text));
      const list = document.createElement("ul");
      list.className = "grammar-productions";
      for (const p of def.productions) {
        const li = document.createElement("li");
        li.textContent = p;
        list.appendChild(li);
      }
      this.definition.appendChild(list);
    }

    this.classification.replaceChildren();
    const type = analysis.classification?.chomsky_type;
    if (analysis.classification) {
      const headline = document.createElement("p");
      headline.className = "chomsky-type";
      headline.textContent = `Tipo ${type} · ${grammarTypeName(type)}`;
      const checks = document.createElement("ul");
      checks.className = "chomsky-checks";
      for (const check of analysis.classification.checks) {
        const li = document.createElement("li");
        li.className = `chomsky-check${check.holds ? " holds" : ""}`;
        li.textContent = `${check.holds ? "✓" : "✗"} Tipo ${check.level}: ${check.explanation}`;
        checks.appendChild(li);
      }
      this.classification.append(headline, checks);
    }
    this._renderTable(type);
  }

  /** The hierarchy reference table, with the grammar's own type marked. */
  _renderTable(currentType) {
    const thead = document.createElement("thead");
    const head = thead.insertRow();
    for (const title of ["Tipo", "Lenguaje", "Autómata", "Producciones", "Ejemplo"]) {
      const th = document.createElement("th");
      th.textContent = title;
      head.appendChild(th);
    }
    const tbody = document.createElement("tbody");
    for (const row of CHOMSKY_TABLE) {
      const tr = tbody.insertRow();
      if (row.type === currentType) tr.className = "current";
      for (const value of [row.type, row.language, row.automaton, row.productions, row.example]) {
        tr.insertCell().textContent = String(value);
      }
    }
    this.table.replaceChildren(thead, tbody);
  }
}

function section(parent, title, className) {
  const h3 = document.createElement("h3");
  h3.textContent = title;
  const body = document.createElement("div");
  body.className = className;
  parent.append(h3, body);
  return body;
}

function line(text) {
  const p = document.createElement("p");
  p.textContent = text;
  return p;
}
