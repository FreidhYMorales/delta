// Shared UI state for the project-level ("Archivo"/File) actions — a NEW,
// SEPARATE context from FA's `ViewContext` (`./context.js`), not folded into
// it (design D8): "Archivo" actions like New/Open/Save must keep working
// even when there is no FA tab open/focused, so this context never depends
// on any FA-specific field (`docStore`, `selection`, etc.). Same
// subscribe/notify shape as `ViewContext` so PR10 can wire both into
// `MenuBar` with minimal glue.

export class ProjectContext {
  /**
   * @param {import('../project/ProjectStore.js').ProjectStore} projectStore
   * @param {{
   *   promptPath?: (kind: 'open-project'|'save-project') => Promise<string|null>,
   *   promptTabName?: (kind: string) => Promise<string|null>,
   *   recentProjects?: import('../project/recentProjects.js').RecentProjects|null,
   * }} [hooks]
   */
  constructor(projectStore, hooks = {}) {
    this.projectStore = projectStore;
    this.promptPath = hooks.promptPath ?? (async () => null);
    this.promptTabName = hooks.promptTabName ?? (async () => null);
    // No safe default recents list exists (unlike `promptPath`'s null
    // no-op) — `null` means "no recents wired", which `projectRegistry.js`'s
    // "Recientes" submenu already treats as an empty list rather than
    // throwing.
    this.recentProjects = hooks.recentProjects ?? null;
    this._listeners = new Set();
    // Forward the store's own notifications (tab list/active-tab changes)
    // as this context's own — the same "one subscribe covers everything a
    // `when(ctx)` reads" contract `ViewContext` already gives every FA
    // action (task 7.5), needed here too now that `MenuBar`'s multi-source
    // contract (design D9) re-renders per-section off each section's own
    // `ctx.subscribe`, not a single shared one.
    projectStore.subscribe(() => this._notify());
  }

  /** @param {(ctx: ProjectContext) => void} listener @returns {() => void} unsubscribe */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _notify() {
    for (const listener of this._listeners) listener(this);
  }
}
