// Frontend mirror of one "Gramática" tab's document (`GrammarSession` in
// Tauri): the source text, its revision (what the project's "unsaved
// changes" tracking reads) and the analysis the core derives from it.
// Much simpler than `DocStore`: no edit ops or patches — every change sends
// the whole text and gets the whole snapshot back.

export class GrammarDocStore {
  /**
   * @param {{grammarSnapshot: Function, grammarSetSource: Function}} client
   * @param {number} tabId
   */
  constructor(client, tabId) {
    this.client = client;
    this.tabId = tabId;
    this.source = "";
    this.revision = 0;
    /** @type {{grammar: object|null, classification: object|null, error: object|null}|null} */
    this.analysis = null;
    this._listeners = new Set();
    // Typing sends one request per pause; an older one resolving after a
    // newer one must not overwrite it.
    this._requestToken = 0;
  }

  /** @param {() => void} listener @returns {() => void} */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  async load() {
    this._adopt(await this.client.grammarSnapshot(this.tabId));
  }

  /** @param {string} source */
  async setSource(source) {
    const token = ++this._requestToken;
    const snapshot = await this.client.grammarSetSource(source, this.tabId);
    if (token === this._requestToken) this._adopt(snapshot);
  }

  /**
   * The core's derivation of `input` from this tab's grammar (read-only:
   * nothing in the document changes).
   * @param {string} input
   * @param {"leftmost"|"rightmost"} order
   */
  derive(input, order) {
    return this.client.grammarDerive(input, order, this.tabId);
  }

  _adopt(snapshot) {
    this.source = snapshot.source;
    this.revision = snapshot.revision;
    this.analysis = snapshot.analysis;
    for (const listener of this._listeners) listener();
  }
}
