// Frontend mirror of the Rust-side `MooreDocument`, same shape and rules
// as `MealyDocStore.js` — mirrors `src-tauri/src/moore_ipc.rs::MooreDocMirror`.
// Kept a separate class rather than a generalized one, same "isolated, not
// a variant" rationale as `MooreDoc` vs `MealyDoc`/`FaDoc` (docs/decisions.md):
// output lives on the state (`output: string|null`), not the edge — edges
// only carry `inputs: string[]`, no `[input,output]` pairing like Mealy's.

/**
 * @typedef {{id:number,label:string,x:number,y:number,initial:boolean,output:string|null}} MooreStateView
 * @typedef {{from:number,to:number,inputs:string[]}} MooreEdgeView
 * @typedef {{input_alphabet:string[],output_alphabet:string[],deterministic:boolean,unreachable:number[]}} MooreDerived
 * @typedef {{revision:number,states:MooreStateView[],edges:MooreEdgeView[],derived:MooreDerived}} MooreDocSnapshot
 * @typedef {{revision:number,patches:object[],derived:MooreDerived}} MooreEditResult
 */

export class MooreDocStore {
  /**
   * @param {{
   *   mooreSnapshot: () => Promise<MooreDocSnapshot>,
   *   mooreApply: (ops: object[]) => Promise<MooreEditResult>,
   *   mooreUndo: () => Promise<MooreEditResult|null>,
   *   mooreRedo: () => Promise<MooreEditResult|null>,
   * }} client
   */
  constructor(client) {
    this.client = client;
    this.revision = 0;
    /** @type {Map<number, MooreStateView>} */
    this.states = new Map();
    /** @type {Map<string, MooreEdgeView>} */
    this.edges = new Map();
    /** @type {MooreDerived} */
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

  /** @param {(store: MooreDocStore) => void} listener @returns {() => void} unsubscribe */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _notify() {
    for (const listener of this._listeners) listener(this);
  }

  /** @returns {MooreStateView[]} sorted by id */
  getStates() {
    return [...this.states.values()].sort((a, b) => a.id - b.id);
  }

  /** @param {number} id */
  getState(id) {
    return this.states.get(id);
  }

  /** @returns {MooreEdgeView[]} sorted by (from, to) */
  getEdges() {
    return [...this.edges.values()].sort((a, b) => a.from - b.from || a.to - b.to);
  }

  /** @param {number} from @param {number} to */
  getEdge(from, to) {
    return this.edges.get(edgeKey(from, to));
  }

  async load() {
    const snapshot = await this.client.mooreSnapshot();
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

  /** @param {object[]} ops MooreEditOpDto[] @returns {Promise<MooreEditResult>} */
  async apply(ops) {
    const result = await this.client.mooreApply(ops);
    await this._applyResult(result);
    return result;
  }

  /** @returns {Promise<MooreEditResult|null>} */
  async undo() {
    const result = await this.client.mooreUndo();
    if (result) await this._applyResult(result);
    return result;
  }

  /** @returns {Promise<MooreEditResult|null>} */
  async redo() {
    const result = await this.client.mooreRedo();
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
 * Pure patch-application step, mirroring `moore_ipc::MooreDocMirror::apply`
 * variant-for-variant.
 * @param {Map<number, MooreStateView>} states
 * @param {Map<string, MooreEdgeView>} edges
 * @param {object} patch
 */
export function applyPatch(states, edges, patch) {
  switch (patch.patch) {
    case "StateAdded":
      states.set(patch.id, { id: patch.id, label: patch.label, x: patch.x, y: patch.y, initial: false, output: null });
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
    case "StateOutputSet": {
      const s = states.get(patch.id);
      if (s) s.output = patch.output;
      break;
    }
    case "EdgeInputsSet":
      edges.set(edgeKey(patch.from, patch.to), { from: patch.from, to: patch.to, inputs: patch.inputs });
      break;
    case "EdgeRemoved":
      edges.delete(edgeKey(patch.from, patch.to));
      break;
    case "AlphabetSet":
      // Derived-only: nothing to mirror locally.
      break;
    default:
      throw new Error(`unknown MooreDocPatch kind: ${patch.patch}`);
  }
}
