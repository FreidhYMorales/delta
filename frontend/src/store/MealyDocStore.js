// Frontend mirror of the Rust-side `MealyDocument`, same shape and rules
// as `DocStore.js` — mirrors `src-tauri/src/mealy_ipc.rs::MealyDocMirror`,
// not `ipc::DocMirror`. Kept a separate class rather than a generalized
// one, same "isolated, not a variant" rationale as `MealyDoc` vs `FaDoc`
// (docs/decisions.md): the shapes genuinely differ (no `accepting`,
// transitions are `[input, output]` pairs instead of a flat symbol list,
// `derived` has two split alphabets and a boolean `deterministic` instead
// of one alphabet and a `classification` string).

/**
 * @typedef {{id:number,label:string,x:number,y:number,initial:boolean}} MealyStateView
 * @typedef {{from:number,to:number,transitions:[string,string][]}} MealyEdgeView
 * @typedef {{input_alphabet:string[],output_alphabet:string[],deterministic:boolean,unreachable:number[]}} MealyDerived
 * @typedef {{revision:number,states:MealyStateView[],edges:MealyEdgeView[],derived:MealyDerived}} MealyDocSnapshot
 * @typedef {{revision:number,patches:object[],derived:MealyDerived}} MealyEditResult
 */

export class MealyDocStore {
  /**
   * @param {{
   *   mealySnapshot: () => Promise<MealyDocSnapshot>,
   *   mealyApply: (ops: object[]) => Promise<MealyEditResult>,
   *   mealyUndo: () => Promise<MealyEditResult|null>,
   *   mealyRedo: () => Promise<MealyEditResult|null>,
   * }} client
   */
  constructor(client) {
    this.client = client;
    this.revision = 0;
    /** @type {Map<number, MealyStateView>} */
    this.states = new Map();
    /** @type {Map<string, MealyEdgeView>} */
    this.edges = new Map();
    /** @type {MealyDerived} */
    this.derived = { input_alphabet: [], output_alphabet: [], deterministic: true, unreachable: [] };
    /** @type {string|null} */
    this.filePath = null;
    this._listeners = new Set();
  }

  /** @param {string} path */
  setFilePath(path) {
    this.filePath = path;
    this._notify();
  }

  /** @param {(store: MealyDocStore) => void} listener @returns {() => void} unsubscribe */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _notify() {
    for (const listener of this._listeners) listener(this);
  }

  /** @returns {MealyStateView[]} sorted by id */
  getStates() {
    return [...this.states.values()].sort((a, b) => a.id - b.id);
  }

  /** @param {number} id */
  getState(id) {
    return this.states.get(id);
  }

  /** @returns {MealyEdgeView[]} sorted by (from, to) */
  getEdges() {
    return [...this.edges.values()].sort((a, b) => a.from - b.from || a.to - b.to);
  }

  /** @param {number} from @param {number} to */
  getEdge(from, to) {
    return this.edges.get(edgeKey(from, to));
  }

  async load() {
    const snapshot = await this.client.mealySnapshot();
    this._loadSnapshot(snapshot);
  }

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

  /** @param {object[]} ops MealyEditOpDto[] @returns {Promise<MealyEditResult>} */
  async apply(ops) {
    const result = await this.client.mealyApply(ops);
    await this._applyResult(result);
    return result;
  }

  /** @returns {Promise<MealyEditResult|null>} */
  async undo() {
    const result = await this.client.mealyUndo();
    if (result) await this._applyResult(result);
    return result;
  }

  /** @returns {Promise<MealyEditResult|null>} */
  async redo() {
    const result = await this.client.mealyRedo();
    if (result) await this._applyResult(result);
    return result;
  }

  async resync() {
    await this.load();
  }

  async _applyResult(result) {
    if (result.revision !== this.revision + 1) {
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
 * Pure patch-application step, mirroring `mealy_ipc::MealyDocMirror::apply`
 * variant-for-variant.
 * @param {Map<number, MealyStateView>} states
 * @param {Map<string, MealyEdgeView>} edges
 * @param {object} patch
 */
export function applyPatch(states, edges, patch) {
  switch (patch.patch) {
    case "StateAdded":
      states.set(patch.id, { id: patch.id, label: patch.label, x: patch.x, y: patch.y, initial: false });
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
    case "StateInitialSet": {
      const s = states.get(patch.id);
      if (s) s.initial = patch.initial;
      break;
    }
    case "EdgeTransitionsSet":
      edges.set(edgeKey(patch.from, patch.to), { from: patch.from, to: patch.to, transitions: patch.entries });
      break;
    case "EdgeRemoved":
      edges.delete(edgeKey(patch.from, patch.to));
      break;
    case "AlphabetSet":
      // Derived-only: nothing to mirror locally.
      break;
    default:
      throw new Error(`unknown MealyDocPatch kind: ${patch.patch}`);
  }
}
