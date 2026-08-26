// The mount dispatcher (design D11, PR11) — given the live `ProjectStore`
// tab list, mounts exactly one `mountXTab` factory result PER TAB (never per
// kind: two open Fa tabs get two independent mounts), keeps every mounted
// tab's DOM permanently in the tree, and exposes `activate`/`deactivate` for
// `ProjectTabStrip`'s own `onActivate`/`onDeactivate` hooks to call.
//
// Deliberately a plain kind -> factory LOOKUP TABLE, not a parameterized
// "mount any kind" function with a kind switch inside its own mounting
// logic — the 5 `mountXTab` factories stay genuinely separate modules (see
// each one's own header comment), this class only ever picks WHICH one to
// call for a given tab's `kind` (docs/decisions.md: dispatch-by-lookup is
// not the same thing as behavioral generalization across kinds).
//
// Mounting reacts to the tab LIST (`ProjectStore.subscribe`, add/remove);
// activation reacts to the ACTIVE POINTER (`ProjectTabStrip`'s callbacks) —
// two independent concerns, since creating a tab does not necessarily also
// activate it (`ProjectStore.newTab` leaves `activeTabId` alone whenever the
// previously active tab still exists — see `ProjectStore.js`'s own
// `_loadManifest`).

import { mountFaTab } from "./tabs/mountFaTab.js";
import { mountMealyTab } from "./tabs/mountMealyTab.js";
import { mountMooreTab } from "./tabs/mountMooreTab.js";
import { mountPdaTab } from "./tabs/mountPdaTab.js";
import { mountTmTab } from "./tabs/mountTmTab.js";

const FACTORY_BY_KIND = {
  Fa: mountFaTab,
  Mealy: mountMealyTab,
  Moore: mountMooreTab,
  Pda: mountPdaTab,
  Tm: mountTmTab,
};

export class TabHost {
  /**
   * @param {{contentHost: HTMLElement, toolbarHost: HTMLElement}} hosts
   * @param {typeof import('../tauri/client.js')} client
   * @param {import('./ProjectStore.js').ProjectStore} projectStore
   */
  constructor(hosts, client, projectStore) {
    this.hosts = hosts;
    this.client = client;
    this.projectStore = projectStore;
    /** @type {Map<number, object>} tabId -> mount handle (`{root, activate, deactivate, ...}`) */
    this._mounts = new Map();

    this._unsubscribe = projectStore.subscribe(() => this._sync());
    this._sync();
  }

  /** @returns {object|undefined} the mount handle for `tabId`, if mounted. */
  getMount(tabId) {
    return this._mounts.get(tabId);
  }

  /** Mounts every tab present in `projectStore.tabs` that isn't mounted yet,
   * and tears down every mount whose tab no longer exists (closed tab). */
  _sync() {
    const liveIds = new Set(this.projectStore.tabs.map((t) => t.id));
    for (const tab of this.projectStore.tabs) {
      if (!this._mounts.has(tab.id)) this._mountTab(tab);
    }
    for (const [tabId, mount] of this._mounts) {
      if (!liveIds.has(tabId)) {
        mount.destroy?.();
        this._mounts.delete(tabId);
      }
    }
  }

  _mountTab(tab) {
    const factory = FACTORY_BY_KIND[tab.kind];
    if (!factory) throw new Error(`TabHost: unknown machine kind "${tab.kind}"`);
    const mount = factory(tab.id, this.hosts, this.client, { projectStore: this.projectStore, tabHost: this });
    this._mounts.set(tab.id, mount);
  }

  /** @param {number} tabId */
  activate(tabId) {
    this._mounts.get(tabId)?.activate();
  }

  /** @param {number} tabId */
  deactivate(tabId) {
    this._mounts.get(tabId)?.deactivate();
  }

  /** Unsubscribes from the store. Call when the whole app shell tears down. */
  destroy() {
    this._unsubscribe?.();
  }
}
