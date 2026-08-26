// Headless model for the project's ordered tab list and active-tab pointer
// (design D14/D8/D10, PR9) — `views/*` (PR10's `ProjectTabStrip`) render
// this, they don't own any of this state themselves.
//
// Dirty-tracking (design D10): `revision` is the LIVE aggregate — the sum of
// every currently-known tab's own `revision` field, exactly mirroring how
// the Rust side's `ProjectManifest::revision` is computed
// (`src-tauri/src/commands/project.rs`). `savedRevision` is the aggregate
// baseline recorded the last time the project was known to be on disk
// unchanged (from `project_open`/`project_save`/`project_new_tab`'s own
// returned `revision`). `isDirty` is just `revision !== savedRevision` — no
// extra IPC call needed: whichever code path already threads a per-kind
// `EditResult.revision` back to this store (PR10's job to wire) only needs
// to call `updateTabRevision(tabId, revision)`, a synchronous, purely local
// update.

/** @typedef {{id: number, kind: string, name: string, revision: number}} ProjectTab */
/** @typedef {{tabs: ProjectTab[], revision: number}} ProjectManifest */

export class ProjectStore {
  /**
   * @param {{
   *   projectNew: () => Promise<ProjectManifest>,
   *   projectManifest: () => Promise<ProjectManifest>,
   *   projectNewTab: (kind: string, name: string) => Promise<ProjectManifest>,
   *   projectCloseTab: (tabId: number) => Promise<ProjectManifest>,
   *   projectRenameTab: (tabId: number, newName: string) => Promise<ProjectManifest>,
   *   projectOpen: (path: string) => Promise<ProjectManifest>,
   *   projectSave: (path: string) => Promise<ProjectManifest>,
   * }} client
   */
  constructor(client) {
    this.client = client;
    /** @type {ProjectTab[]} */
    this.tabs = [];
    /** @type {number|null} */
    this.activeTabId = null;
    this.savedRevision = 0;
    // Per-tab dirty baseline (PR10's `ProjectTabStrip` dirty-dot), additive
    // to the aggregate `isDirty` above — same "no extra IPC" rule: a tab's
    // baseline is only ever moved forward by a manifest load that counts as
    // saved (`markSaved: true`), exactly mirroring how `savedRevision` itself
    // is only bumped on that same condition. `updateTabRevision` (an existing
    // PR9 seam) already keeps a tab's own live `revision` current, so a
    // per-tab dirty check is just `tab.revision !== baseline`, no polling.
    this._tabSavedRevision = new Map();
    this._listeners = new Set();
  }

  /** @param {(store: ProjectStore) => void} listener @returns {() => void} unsubscribe */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _notify() {
    for (const listener of this._listeners) listener(this);
  }

  /** The live aggregate revision — the sum of every known tab's own `revision`. */
  get revision() {
    return this.tabs.reduce((sum, tab) => sum + tab.revision, 0);
  }

  /** @returns {boolean} true whenever the live aggregate has moved past the
   * last-known-saved baseline (design D10). */
  get isDirty() {
    return this.revision !== this.savedRevision;
  }

  /**
   * Directly updates a single tab's own `revision` (called by whatever code
   * threads a per-kind `DocStore`-family `EditResult.revision` back here —
   * PR10's job) without any extra `project_manifest` round-trip.
   * @param {number} tabId
   * @param {number} revision
   */
  updateTabRevision(tabId, revision) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    tab.revision = revision;
    this._notify();
  }

  /**
   * @param {number} tabId
   * @returns {boolean} true when this one tab's own `revision` has moved past
   * its last-known-saved baseline. Unknown tab ids are reported clean rather
   * than throwing, same defensive style as `updateTabRevision`'s own no-op.
   */
  isTabDirty(tabId) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return false;
    return tab.revision !== this._tabSavedRevision.get(tabId);
  }

  _loadManifest(manifest, { markSaved }) {
    this.tabs = manifest.tabs.map((tab) => ({ ...tab }));
    if (this.activeTabId == null || !this.tabs.some((t) => t.id === this.activeTabId)) {
      this.activeTabId = this.tabs[0]?.id ?? null;
    }
    if (markSaved) this.savedRevision = manifest.revision;
    // Drop baselines for tabs that no longer exist (closed), and (re)stamp
    // every remaining tab's baseline when this load counts as saved. A tab
    // seen for the first time on a NOT-saved load (e.g. `refresh()` picking
    // up a tab created elsewhere) gets its current revision as its initial
    // baseline — there is no earlier "clean" point to compare against, so
    // treating it as clean-until-edited matches the aggregate's own
    // first-seen behavior.
    const liveIds = new Set(this.tabs.map((t) => t.id));
    for (const id of this._tabSavedRevision.keys()) {
      if (!liveIds.has(id)) this._tabSavedRevision.delete(id);
    }
    for (const tab of this.tabs) {
      if (markSaved || !this._tabSavedRevision.has(tab.id)) {
        this._tabSavedRevision.set(tab.id, tab.revision);
      }
    }
    this._notify();
  }

  /** @param {number} tabId */
  setActiveTab(tabId) {
    this.activeTabId = tabId;
    this._notify();
  }

  /** @returns {Promise<ProjectManifest>} resets to a fresh, empty project — clean. */
  async newProject() {
    const manifest = await this.client.projectNew();
    this._loadManifest(manifest, { markSaved: true });
    return manifest;
  }

  /** @returns {Promise<ProjectManifest>} re-fetches the current tab list/aggregate
   * revision without changing the dirty baseline. */
  async refresh() {
    const manifest = await this.client.projectManifest();
    this._loadManifest(manifest, { markSaved: false });
    return manifest;
  }

  /** @param {string} kind @param {string} name @returns {Promise<ProjectManifest>} */
  async newTab(kind, name) {
    const manifest = await this.client.projectNewTab(kind, name);
    this._loadManifest(manifest, { markSaved: true });
    return manifest;
  }

  /** @param {number} tabId @returns {Promise<ProjectManifest>} */
  async closeTab(tabId) {
    const manifest = await this.client.projectCloseTab(tabId);
    this._loadManifest(manifest, { markSaved: false });
    return manifest;
  }

  /** @param {number} tabId @param {string} newName @returns {Promise<ProjectManifest>} */
  async renameTab(tabId, newName) {
    const manifest = await this.client.projectRenameTab(tabId, newName);
    this._loadManifest(manifest, { markSaved: false });
    return manifest;
  }

  /** @param {string} path @returns {Promise<ProjectManifest>} */
  async open(path) {
    const manifest = await this.client.projectOpen(path);
    this._loadManifest(manifest, { markSaved: true });
    return manifest;
  }

  /** @param {string} path @returns {Promise<ProjectManifest>} */
  async save(path) {
    const manifest = await this.client.projectSave(path);
    this._loadManifest(manifest, { markSaved: true });
    return manifest;
  }
}
