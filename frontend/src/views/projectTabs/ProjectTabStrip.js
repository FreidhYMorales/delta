// The project-level tab strip (design D7, PR10) — renders the ORDERED tab
// list straight out of `ProjectStore`, nothing more. Deliberately a brand
// new widget, NOT a reuse/extension of `ui/tabs.js`: that widget owns a
// caller-supplied panel per tab and switches which panel is visible
// (`.tab-panel.active`); this one owns no panes at all — mounting/hiding an
// actual document view per tab is PR11's "mount factory" concern (design
// D11: mounted tabs stay in the DOM, `activate()`/`deactivate()` just toggle
// `hidden`). This widget's only job is the STRIP: add/close/rename a tab,
// show a dirty-dot and a kind-badge, and tell a caller which tab became
// active/inactive — never touching the DOM of any document pane itself.
//
// Rename validation mirrors the backend's own `project_rename_tab`
// rejection (empty name / a name already used by a sibling tab): on either
// case this "silently reverts" — no alert, no notice, just redraw with the
// previous name — exactly like `ui/promptModal.js`'s Escape/backdrop-cancel
// convention resolves quietly instead of surfacing an error.

import { machineKindLabel } from "../../project/machineKinds.js";

export class ProjectTabStrip {
  /**
   * @param {HTMLElement} container
   * @param {import('../../project/ProjectStore.js').ProjectStore} projectStore
   * @param {{
   *   onActivate?: (tabId: number) => void,
   *   onDeactivate?: (tabId: number) => void,
   * }} [hooks]
   */
  constructor(container, projectStore, hooks = {}) {
    this.container = container;
    this.projectStore = projectStore;
    this.onActivate = hooks.onActivate ?? (() => {});
    this.onDeactivate = hooks.onDeactivate ?? (() => {});
    /** @type {number|null} tracked only to detect an activation change on
     * re-render — this widget never decides activation itself. */
    this._lastActiveTabId = projectStore.activeTabId;

    this.root = document.createElement("div");
    this.root.className = "project-tab-strip";
    this.container.appendChild(this.root);

    this._unsubscribe = projectStore.subscribe(() => this._render());
    this._render();
  }

  /** Unsubscribes from the store. Call when the strip itself is torn down. */
  destroy() {
    this._unsubscribe?.();
  }

  /**
   * Programmatic "new tab" entry point — the actual kind/name prompt lives
   * in `commands/projectRegistry.js`'s `project.newTab.<kind>` actions
   * (PR9); this is just the delegation seam a caller (a menu action, a "+"
   * button PR11 may add) can invoke without reaching into `projectStore`
   * directly.
   * @param {string} kind @param {string} name
   */
  addTab(kind, name) {
    return this.projectStore.newTab(kind, name);
  }

  _render() {
    this.root.innerHTML = "";
    for (const tab of this.projectStore.tabs) {
      this.root.appendChild(this._buildTabButton(tab));
    }
    this._notifyActivationChange();
  }

  _notifyActivationChange() {
    const nextActiveTabId = this.projectStore.activeTabId;
    if (nextActiveTabId === this._lastActiveTabId) return;
    if (this._lastActiveTabId != null) this.onDeactivate(this._lastActiveTabId);
    if (nextActiveTabId != null) this.onActivate(nextActiveTabId);
    this._lastActiveTabId = nextActiveTabId;
  }

  _buildTabButton(tab) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "project-tab";
    button.dataset.tabId = String(tab.id);
    button.classList.toggle("active", tab.id === this.projectStore.activeTabId);

    const badge = document.createElement("span");
    badge.className = "project-tab-kind-badge";
    badge.textContent = machineKindLabel(tab.kind) ?? tab.kind;
    button.appendChild(badge);

    const nameSpan = document.createElement("span");
    nameSpan.className = "project-tab-name";
    nameSpan.textContent = tab.name;
    button.appendChild(nameSpan);

    if (this.projectStore.isTabDirty(tab.id)) {
      const dot = document.createElement("span");
      dot.className = "project-tab-dirty-dot";
      button.appendChild(dot);
    }

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "project-tab-close";
    closeButton.textContent = "×";
    closeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.projectStore.closeTab(tab.id);
    });
    button.appendChild(closeButton);

    button.addEventListener("click", () => {
      this.projectStore.setActiveTab(tab.id);
    });
    button.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      this._startRename(tab, button, nameSpan);
    });

    return button;
  }

  _startRename(tab, button, nameSpan) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "project-tab-rename-input";
    input.value = tab.name;

    let settled = false;
    const revert = () => {
      if (settled) return;
      settled = true;
      this._render();
    };
    const commit = async () => {
      if (settled) return;
      settled = true;
      const newName = input.value.trim();
      const isDuplicate = this.projectStore.tabs.some((t) => t.id !== tab.id && t.name === newName);
      if (!newName || isDuplicate) {
        // Silently revert (no alert/notice) — mirrors `project_rename_tab`'s
        // own rejection for an empty or already-used name.
        this._render();
        return;
      }
      await this.projectStore.renameTab(tab.id, newName);
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        revert();
      }
    });
    input.addEventListener("blur", commit);

    nameSpan.replaceWith(input);
    input.focus();
    input.select();
  }
}
