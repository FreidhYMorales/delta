// Read-only derivation of the regular expression equivalent to the current
// automaton (`automata_core::convert::fa_to_regex`, via `ctx.toRegex` ->
// the `conv_to_regex` Tauri command). First concrete step towards a real
// "Expresión Regular" editor mode (still a disabled option in the
// Toolbar.js mode select): this direction (automaton -> regex) needed no
// new document type or IPC mutation surface, just one derived value, so it
// ships first — regex -> automaton (typing a regex and materializing a new
// FA document) is a separate, bigger step for later.

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

    this.root.append(this.label, this.output);
    this.container.appendChild(this.root);
  }

  async _refresh() {
    const token = ++this._requestToken;
    const regex = await this.ctx.toRegex();
    if (token !== this._requestToken) return;
    this.output.value = regex;
  }
}
