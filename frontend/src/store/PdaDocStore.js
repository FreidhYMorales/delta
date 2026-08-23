// Frontend mirror of the Rust-side `PdaDocument`, same shape and rules as
// `MooreDocStore.js` — mirrors `src-tauri/src/pda_ipc.rs::PdaDocMirror`.
// Kept a separate class rather than a generalized one, same "isolated, not
// a variant" rationale as `PdaDoc` vs `MealyDoc`/`MooreDoc`/`FaDoc`
// (docs/decisions.md): PDA has accepting states (`accepting: boolean` on
// each state, unlike Mealy/Moore) and its transitions are a FLAT,
// individually-addressable list keyed by `id`, NOT grouped by `(from, to)`
// like FA/Mealy/Moore's edges — several transitions can share the same
// `(from, to)` pair with different `(input, pop, push)` triples.

/**
 * @typedef {{id:number,label:string,x:number,y:number,initial:boolean,accepting:boolean}} PdaStateView
 * @typedef {{id:number,from:number,to:number,input:string|null,pop:string[],push:string[]}} PdaTransitionView
 * @typedef {{input_alphabet:string[],stack_alphabet:string[],deterministic:boolean,unreachable:number[]}} PdaDerived
 * @typedef {{revision:number,states:PdaStateView[],transitions:PdaTransitionView[],derived:PdaDerived}} PdaDocSnapshot
 * @typedef {{revision:number,patches:object[],derived:PdaDerived}} PdaEditResult
 */

export class PdaDocStore {
  /**
   * @param {{
   *   pdaSnapshot: () => Promise<PdaDocSnapshot>,
   *   pdaApply: (ops: object[]) => Promise<PdaEditResult>,
   *   pdaUndo: () => Promise<PdaEditResult|null>,
   *   pdaRedo: () => Promise<PdaEditResult|null>,
   * }} client
   */
  constructor(client) {
    this.client = client;
    this.revision = 0;
    /** @type {Map<number, PdaStateView>} */
    this.states = new Map();
    /** @type {Map<number, PdaTransitionView>} */
    this.transitions = new Map();
    /** @type {PdaDerived} */
    this.derived = { input_alphabet: [], stack_alphabet: [], deterministic: true, unreachable: [] };
    /** @type {string|null} */
    this.filePath = null;
    this._listeners = new Set();
  }

  /** @param {string} path */
  setFilePath(path) {
    this.filePath = path;
    this._notify();
  }

  /** @param {(store: PdaDocStore) => void} listener @returns {() => void} unsubscribe */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _notify() {
    for (const listener of this._listeners) listener(this);
  }

  /** @returns {PdaStateView[]} sorted by id */
  getStates() {
    return [...this.states.values()].sort((a, b) => a.id - b.id);
  }

  /** @param {number} id */
  getState(id) {
    return this.states.get(id);
  }

  /** @returns {PdaTransitionView[]} sorted by id */
  getTransitions() {
    return [...this.transitions.values()].sort((a, b) => a.id - b.id);
  }

  /** @param {number} id */
  getTransition(id) {
    return this.transitions.get(id);
  }

  /** @param {number} from @param {number} to @returns {PdaTransitionView[]} every
   * transition sharing this `(from, to)` pair, sorted by id — the grouping
   * `PdaDiagramView` uses to fan multiple arcs apart. */
  getTransitionsBetween(from, to) {
    return this.getTransitions().filter((t) => t.from === from && t.to === to);
  }

  async load() {
    const snapshot = await this.client.pdaSnapshot();
    this._loadSnapshot(snapshot);
  }

  loadSnapshot(snapshot) {
    this._loadSnapshot(snapshot);
  }

  _loadSnapshot(snapshot) {
    this.revision = snapshot.revision;
    this.states = new Map(snapshot.states.map((s) => [s.id, s]));
    this.transitions = new Map(snapshot.transitions.map((t) => [t.id, t]));
    this.derived = snapshot.derived;
    this._notify();
  }

  /** @param {object[]} ops PdaEditOpDto[] @returns {Promise<PdaEditResult>} */
  async apply(ops) {
    const result = await this.client.pdaApply(ops);
    await this._applyResult(result);
    return result;
  }

  /** @returns {Promise<PdaEditResult|null>} */
  async undo() {
    const result = await this.client.pdaUndo();
    if (result) await this._applyResult(result);
    return result;
  }

  /** @returns {Promise<PdaEditResult|null>} */
  async redo() {
    const result = await this.client.pdaRedo();
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
    for (const patch of patches) applyPatch(this.states, this.transitions, patch);
  }
}

/**
 * Pure patch-application step, mirroring `pda_ipc::PdaDocMirror::apply`
 * variant-for-variant. Cascaded removals (e.g. a `RemoveState` that also
 * drops its incident transitions) always arrive as explicit
 * `TransitionRemoved` patches too — `pda_ipc::diff_patches` diffs the whole
 * before/after transition set, so nothing needs bespoke cascade handling
 * here.
 * @param {Map<number, PdaStateView>} states
 * @param {Map<number, PdaTransitionView>} transitions
 * @param {object} patch
 */
export function applyPatch(states, transitions, patch) {
  switch (patch.patch) {
    case "StateAdded":
      states.set(patch.id, { id: patch.id, label: patch.label, x: patch.x, y: patch.y, initial: false, accepting: false });
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
    case "StateAcceptingSet": {
      const s = states.get(patch.id);
      if (s) s.accepting = patch.accepting;
      break;
    }
    case "TransitionAdded":
      transitions.set(patch.id, { id: patch.id, from: patch.from, to: patch.to, input: patch.input, pop: patch.pop, push: patch.push });
      break;
    case "TransitionRemoved":
      transitions.delete(patch.id);
      break;
    case "TransitionEdited": {
      const t = transitions.get(patch.id);
      if (t) {
        t.input = patch.input;
        t.pop = patch.pop;
        t.push = patch.push;
      }
      break;
    }
    case "AlphabetSet":
      // Derived-only: nothing to mirror locally.
      break;
    default:
      throw new Error(`unknown PdaDocPatch kind: ${patch.patch}`);
  }
}
