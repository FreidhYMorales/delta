// Frontend mirror of the Rust-side `Document` (design D3/D6). Applies the
// `DocPatch[]` diff returned by `doc_apply`/`doc_undo`/`doc_redo` to a local
// `states`/`edges` map, tracks `revision`, and falls back to a full
// `doc_snapshot` resync whenever the returned revision is not exactly the
// expected next one (design D3: "full `doc_snapshot` only on open/import or
// `revision` mismatch (resync)"). This mirrors the shape of the Rust-side
// `ipc::DocMirror` built in PR4 (`src-tauri/src/ipc.rs`) as its own
// reference implementation for this exact reducer.

/**
 * @typedef {{id:number,label:string,x:number,y:number,initial:boolean,accepting:boolean}} StateView
 * @typedef {{from:number,to:number,epsilon:boolean,symbols:string[]}} EdgeView
 * @typedef {{classification:string,alphabet:string[],unreachable:number[]}} Derived
 * @typedef {{revision:number,states:StateView[],edges:EdgeView[],derived:Derived}} DocSnapshot
 * @typedef {{revision:number,patches:object[],derived:Derived}} EditResult
 */

export class DocStore {
  /**
   * @param {{
   *   docSnapshot: () => Promise<DocSnapshot>,
   *   docApply: (ops: object[]) => Promise<EditResult>,
   *   docUndo: () => Promise<EditResult|null>,
   *   docRedo: () => Promise<EditResult|null>,
   * }} client
   */
  constructor(client) {
    this.client = client;
    this.revision = 0;
    /** @type {Map<number, StateView>} */
    this.states = new Map();
    /** @type {Map<string, EdgeView>} */
    this.edges = new Map();
    /** @type {Derived} */
    this.derived = { classification: "Dfa", alphabet: [], unreachable: [] };
    /** @type {string|null} filesystem path of the last imported/exported .jff,
     * for the canvas info bar's filename chip (wireframe parity). */
    this.filePath = null;
    this._listeners = new Set();
  }

  /** @param {string} path */
  setFilePath(path) {
    this.filePath = path;
    this._notify();
  }

  /** @param {(store: DocStore) => void} listener @returns {() => void} unsubscribe */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _notify() {
    for (const listener of this._listeners) listener(this);
  }

  /** @returns {StateView[]} sorted by id, mirrors `snapshot_of`'s ordering */
  getStates() {
    return [...this.states.values()].sort((a, b) => a.id - b.id);
  }

  /** @param {number} id */
  getState(id) {
    return this.states.get(id);
  }

  /** @returns {EdgeView[]} sorted by (from, to) */
  getEdges() {
    return [...this.edges.values()].sort((a, b) => a.from - b.from || a.to - b.to);
  }

  /** @param {number} from @param {number} to */
  getEdge(from, to) {
    return this.edges.get(edgeKey(from, to));
  }

  /** Full resync from `doc_snapshot` — used on load and whenever the
   * incremental patch stream can no longer be trusted. */
  async load() {
    const snapshot = await this.client.docSnapshot();
    this._loadSnapshot(snapshot);
  }

  /** Explicit alias kept for callers that want to name the intent (e.g.
   * `doc_open`/`jff_import` handlers already have a full snapshot in hand
   * and should call `loadSnapshot` directly instead of re-fetching). */
  loadSnapshot(snapshot) {
    this._loadSnapshot(snapshot);
  }

  _loadSnapshot(snapshot) {
    this.revision = snapshot.revision;
    this.states = new Map(snapshot.states.map((s) => [s.id, s]));
    this.edges = new Map(snapshot.edges.map((e) => [edgeKey(e.from, e.to), e]));
    this.derived = snapshot.derived;
    this._notify();
  }

  /** @param {object[]} ops EditOpDto[] @returns {Promise<EditResult>} */
  async apply(ops) {
    const result = await this.client.docApply(ops);
    await this._applyResult(result);
    return result;
  }

  /** @returns {Promise<EditResult|null>} */
  async undo() {
    const result = await this.client.docUndo();
    if (result) await this._applyResult(result);
    return result;
  }

  /** @returns {Promise<EditResult|null>} */
  async redo() {
    const result = await this.client.docRedo();
    if (result) await this._applyResult(result);
    return result;
  }

  /** Force a full resync regardless of the current revision. */
  async resync() {
    await this.load();
  }

  async _applyResult(result) {
    if (result.revision !== this.revision + 1) {
      // The server moved further than one step away from what we last knew
      // (e.g. another session/window mutated the document, or a patch was
      // dropped in transit) — the incremental diff can no longer be trusted,
      // so fall back to the authoritative full snapshot (design D3).
      await this.resync();
      return;
    }
    this._applyPatches(result.patches);
    this.revision = result.revision;
    this.derived = result.derived;
    this._notify();
  }

  _applyPatches(patches) {
    for (const patch of patches) applyPatch(this.states, this.edges, patch);
  }
}

function edgeKey(from, to) {
  return `${from}:${to}`;
}

/**
 * Pure patch-application step, mirroring `automata_core`'s IPC-side
 * `ipc::DocMirror::apply` (`src-tauri/src/ipc.rs`) variant-for-variant.
 * Exported for direct unit testing of individual patch kinds if needed.
 * @param {Map<number, StateView>} states
 * @param {Map<string, EdgeView>} edges
 * @param {object} patch
 */
export function applyPatch(states, edges, patch) {
  switch (patch.patch) {
    case "StateAdded":
      states.set(patch.id, {
        id: patch.id,
        label: patch.label,
        x: patch.x,
        y: patch.y,
        initial: false,
        accepting: false,
      });
      break;
    case "StateRemoved":
      states.delete(patch.id);
      break;
    case "StateMoved": {
      const s = states.get(patch.id);
      if (s) {
        s.x = patch.x;
        s.y = patch.y;
      }
      break;
    }
    case "StateRenamed": {
      const s = states.get(patch.id);
      if (s) s.label = patch.label;
      break;
    }
    case "StateFlagsSet": {
      const s = states.get(patch.id);
      if (s) {
        s.initial = patch.initial;
        s.accepting = patch.accepting;
      }
      break;
    }
    case "EdgeSymbolsSet":
      edges.set(edgeKey(patch.from, patch.to), {
        from: patch.from,
        to: patch.to,
        epsilon: patch.epsilon,
        symbols: patch.symbols,
      });
      break;
    case "EdgeRemoved":
      edges.delete(edgeKey(patch.from, patch.to));
      break;
    case "AlphabetSet":
      // Derived-only: nothing to mirror locally, `EditResult.derived.alphabet`
      // already carries the authoritative value applied in `_applyResult`.
      break;
    default:
      throw new Error(`unknown DocPatch kind: ${patch.patch}`);
  }
}
