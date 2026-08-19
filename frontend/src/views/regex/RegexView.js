// Both directions of the FA<->regex loop, in one tab (first concrete step
// towards a real "Expresión Regular" editor mode — still a disabled option
// in Toolbar.js's mode select; neither direction here needed that bigger
// switchable-document-type architecture, so they ship first):
//  - automaton -> regex (`ctx.toRegex`, `conv_to_regex`): read-only, derived
//    from the current document, re-fetched on every change.
//  - regex -> automaton (`ctx.fromRegex`, `conv_from_regex`): typing a
//    pattern and clicking Generar REPLACES the current document — same
//    "whole-document swap" shape as opening a file, not an edit to it.

export class RegexView {
  /**
   * @param {HTMLElement} container
   * @param {import('../../store/DocStore.js').DocStore} docStore
   * @param {import('../../commands/context.js').ViewContext} ctx
   */
  constructor(container, docStore, ctx) {
    this.container = container;
    this.docStore = docStore;
    this.ctx = ctx;
    // Every doc change starts a fresh fetch; a stale in-flight one (e.g. two
    // edits committed in quick succession) must never overwrite a newer
    // result once it resolves out of order — this token is the guard.
    this._requestToken = 0;
    this._build();
    docStore.subscribe(() => {
      this._lastRefreshPromise = this._refresh();
    });
    this._lastRefreshPromise = this._refresh();
  }

  _build() {
    this.root = document.createElement("div");
    this.root.className = "regex-view";

    this.label = document.createElement("div");
    this.label.className = "regex-view-label";
    this.label.textContent = "Expresión regular equivalente";

    this.output = document.createElement("textarea");
    this.output.className = "regex-output";
    this.output.readOnly = true;

    const genLabel = document.createElement("label");
    genLabel.className = "field-label";
    genLabel.textContent = "Generar autómata desde una expresión regular";

    this.genInput = document.createElement("input");
    this.genInput.type = "text";
    this.genInput.className = "regex-input string-input";
    this.genInput.placeholder = "p.ej. a(b+c)*";

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
    this.genError.className = "regex-error";

    this.root.append(this.label, this.output, genLabel, this.genInput, genRow, this.genError);
    this.container.appendChild(this.root);
  }

  async _refresh() {
    const token = ++this._requestToken;
    const regex = await this.ctx.toRegex();
    if (token !== this._requestToken) return;
    this.output.value = regex;
  }

  async _onGenerate() {
    this.genError.textContent = "";
    try {
      await this.ctx.fromRegex(this.genInput.value);
    } catch (error) {
      this.genError.textContent = String(error?.message ?? error);
    }
  }
}
