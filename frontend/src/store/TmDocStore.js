// Frontend mirror of the Rust-side `TmDoc`, same shape and rules as
// `PdaDocStore.js` — mirrors `src-tauri/src/tm_ipc.rs::TmDocMirror`. Kept a
// separate class rather than a generalized one, same "isolated, not a
// variant" rationale as `PdaDoc` vs `MealyDoc`/`MooreDoc`/`FaDoc`
// (docs/decisions.md).
//
// Differences from `PdaDocStore.js`, all traceable to `TmDoc`'s own shape:
//  - A transition carries `tapes: {read,write,direction}[]` (one triple per
//    tape) instead of PDA's single `(input, pop, push)` triple — still a
//    FLAT, individually-addressable list keyed by `id`, same as PDA's.
//  - ONE alphabet, not two (`TmDerived.alphabet`, not PDA's
//    `input_alphabet`/`stack_alphabet` pair).
//  - `TmDerived` also carries `tape_count` — no PDA analog — locked to a
//    fixed value once the first transition is ever added
//    (`model::tm.rs`'s doc comment). The combined "derived facts changed"
//    patch is named `DerivedSet`, not `AlphabetSet` like PDA's, since it now
//    covers `tape_count` too.

/**
 * @typedef {{id:number,label:string,x:number,y:number,initial:boolean,accepting:boolean}} TmStateView
 * @typedef {{read:string,write:string,direction:string}} TmTapeOpView
 * @typedef {{id:number,from:number,to:number,tapes:TmTapeOpView[]}} TmTransitionView
 * @typedef {{alphabet:string[],tape_count:number,deterministic:boolean,unreachable:number[]}} TmDerived
 * @typedef {{revision:number,states:TmStateView[],transitions:TmTransitionView[],derived:TmDerived}} TmDocSnapshot
 * @typedef {{revision:number,patches:object[],derived:TmDerived}} TmEditResult
 */

export class TmDocStore {
  /**
   * @param {{
   *   tmSnapshot: () => Promise<TmDocSnapshot>,
   *   tmApply: (ops: object[]) => Promise<TmEditResult>,
   *   tmUndo: () => Promise<TmEditResult|null>,
   *   tmRedo: () => Promise<TmEditResult|null>,
   * }} client
   */
  constructor(client) {
    this.client = client;
    this.revision = 0;
    /** @type {Map<number, TmStateView>} */
    this.states = new Map();
    /** @type {Map<number, TmTransitionView>} */
    this.transitions = new Map();
    /** @type {TmDerived} */
    this.derived = { alphabet: [], tape_count: 0, deterministic: true, unreachable: [] };
    /** @type {string|null} */
    this.filePath = null;
    this._listeners = new Set();
  }

  /** @param {string} path */
  setFilePath(path) {
    this.filePath = path;
    this._notify();
  }

  /** @param {(store: TmDocStore) => void} listener @returns {() => void} unsubscribe */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _notify() {
    for (const listener of this._listeners) listener(this);
  }

  /** @returns {TmStateView[]} sorted by id */
  getStates() {
    return [...this.states.values()].sort((a, b) => a.id - b.id);
  }

  /** @param {number} id */
  getState(id) {
    return this.states.get(id);
  }

  /** @returns {TmTransitionView[]} sorted by id */
  getTransitions() {
    return [...this.transitions.values()].sort((a, b) => a.id - b.id);
  }

  /** @param {number} id */
  getTransition(id) {
    return this.transitions.get(id);
  }

  /** @param {number} from @param {number} to @returns {TmTransitionView[]} every
   * transition sharing this `(from, to)` pair, sorted by id — the grouping
   * `TmDiagramView` uses to fan multiple arcs apart. */
  getTransitionsBetween(from, to) {
    return this.getTransitions().filter((t) => t.from === from && t.to === to);
  }

  async load() {
    const snapshot = await this.client.tmSnapshot();
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

  /** @param {object[]} ops TmEditOpDto[] @returns {Promise<TmEditResult>} */
  async apply(ops) {
    const result = await this.client.tmApply(ops);
    await this._applyResult(result);
    return result;
  }

  /** @returns {Promise<TmEditResult|null>} */
  async undo() {
    const result = await this.client.tmUndo();
    if (result) await this._applyResult(result);
    return result;
  }

  /** @returns {Promise<TmEditResult|null>} */
  async redo() {
    const result = await this.client.tmRedo();
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
 * Pure patch-application step, mirroring `tm_ipc::TmDocMirror::apply`
 * variant-for-variant. Cascaded removals arrive as explicit
 * `TransitionRemoved` patches too, same "no bespoke cascade handling needed
 * here" reasoning as `PdaDocStore.js`'s own `applyPatch`.
 * @param {Map<number, TmStateView>} states
 * @param {Map<number, TmTransitionView>} transitions
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
      transitions.set(patch.id, { id: patch.id, from: patch.from, to: patch.to, tapes: patch.tapes });
      break;
    case "TransitionRemoved":
      transitions.delete(patch.id);
      break;
    case "TransitionEdited": {
      const t = transitions.get(patch.id);
      if (t) t.tapes = patch.tapes;
      break;
    }
    case "DerivedSet":
      // Derived-only: nothing to mirror locally (mirrors PDA's `AlphabetSet`
      // handling — see `tm_ipc.rs`'s doc comment for why this patch is named
      // `DerivedSet` rather than reusing PDA's `AlphabetSet` name).
      break;
    default:
      throw new Error(`unknown TmDocPatch kind: ${patch.patch}`);
  }
}
