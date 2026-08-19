// Both directions of the FA<->right-linear-grammar loop, in one tab — same
// shape as `RegexView.js` (see its own header comment for the full "why a
// tab, not a document-type switch" reasoning; it applies here unchanged,
// grammar isn't a state machine either):
//  - automaton -> grammar (`ctx.toGrammar`, `conv_to_grammar`): read-only,
//    derived from the current document, re-fetched on every change. Shown
//    in `grammar::format`'s syntax (space-delimited, one production per
//    line — see its Rust doc comment), not `RegularGrammar`'s more compact
//    `Display`, specifically so it's copy-paste-able into the box below.
//  - grammar -> automaton (`ctx.fromGrammar`, `conv_from_grammar`): typing
//    productions and clicking Generar REPLACES the current document, same
//    "whole-document swap" shape as opening a file.

export class GrammarView {
  /**
   * @param {HTMLElement} container
   * @param {import('../../store/DocStore.js').DocStore} docStore
   * @param {import('../../commands/context.js').ViewContext} ctx
   */
  constructor(container, docStore, ctx) {
    this.container = container;
    this.docStore = docStore;
    this.ctx = ctx;
    // Same out-of-order-fetch guard as RegexView — see its comment.
    this._requestToken = 0;
    this._build();
    docStore.subscribe(() => {
      this._lastRefreshPromise = this._refresh();
    });
    this._lastRefreshPromise = this._refresh();
  }

  _build() {
    this.root = document.createElement("div");
    this.root.className = "grammar-view";

    this.label = document.createElement("div");
    this.label.className = "grammar-view-label";
    this.label.textContent = "Gramática regular equivalente";

    this.output = document.createElement("textarea");
    this.output.className = "grammar-output";
    this.output.readOnly = true;

    const genLabel = document.createElement("label");
    genLabel.className = "field-label";
    genLabel.textContent = "Generar autómata desde una gramática regular (una producción por línea)";

    this.genInput = document.createElement("textarea");
    this.genInput.className = "grammar-input string-input";
    this.genInput.placeholder = "p.ej.\nq0 -> a q1\nq1 -> ε";

    this.genButton = document.createElement("button");
    this.genButton.type = "button";
    this.genButton.className = "btn-primary";
    this.genButton.textContent = "Generar autómata (reemplaza el actual) →";
    this.genButton.addEventListener("click", () => {
      this._lastGeneratePromise = this._onGenerate();
    });
    const genRow = document.createElement("div");
    genRow.className = "calc-row";
    genRow.appendChild(this.genButton);

    this.genError = document.createElement("div");
    this.genError.className = "grammar-error";

    this.root.append(this.label, this.output, genLabel, this.genInput, genRow, this.genError);
    this.container.appendChild(this.root);
  }

  async _refresh() {
    const token = ++this._requestToken;
    const text = await this.ctx.toGrammar();
    if (token !== this._requestToken) return;
    this.output.value = text;
  }

  async _onGenerate() {
    this.genError.textContent = "";
    try {
      await this.ctx.fromGrammar(this.genInput.value);
    } catch (error) {
      this.genError.textContent = String(error?.message ?? error);
    }
  }
}
