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
//
// Many-tabs overflow (follow-up fix): tab buttons never shrink
// (`.project-tab { flex-shrink: 0 }` — see style.css) so names/badges stay
// readable instead of squishing down as more tabs open. The tab list itself
// lives in its own scrollable `.project-tab-strip-scroll` sub-element
// (`this.scrollArea`), separate from `this.root`, so the two nav buttons
// (`this.nav`) can stay docked at the right edge, outside the scrolling
// area, instead of scrolling away with the tabs. Plain wheel scroll
// (deltaY, no deltaX — most mice have no horizontal wheel) and a
// click-and-drag pan are both wired onto `scrollArea` as swipe-like
// affordances; a real trackpad's horizontal swipe (deltaX != 0) is left
// alone entirely, since the browser already scrolls an `overflow-x: auto`
// element for that natively.

// Drag-to-reorder (follow-up feature): click-and-hold a TAB itself (not
// empty strip background) and move left/right to reposition it —
// `_wireReorderDrag`. A tab button's own mousedown calls
// `stopPropagation()` so `_wireDragPan`'s strip-panning never also engages
// for the same gesture: pressing a tab reorders it, pressing anywhere else
// on the strip pans it. The dragged button just follows the pointer via a
// `transform: translateX(...)` (no live sibling reflow — keeps this simple
// and avoids fighting the still-running `_render()` on every store
// change); the actual `project_reorder_tab` call, computed from which
// sibling's midpoint the pointer ended up past, only fires once, on
// mouseup, exactly like `_wireDragPan`'s own one-shot click suppression.

import { machineKindLabel } from "../../project/machineKinds.js";

/** Pixels the nav buttons pan per click — roughly 2-3 tabs' width, enough
 * to feel like a deliberate step without needing a "page" calculation. */
const NAV_SCROLL_STEP = 160;

/** Below this many pixels of horizontal mouse movement, a mousedown/mouseup
 * pair is still just a click (opening/renaming a tab), not a drag-to-pan —
 * without a threshold, EVERY normal click would register as a zero-distance
 * "drag" and get its own click event wrongly suppressed (see `_wireDragToPan`
 * below). */
const DRAG_THRESHOLD_PX = 4;

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

    this.scrollArea = document.createElement("div");
    this.scrollArea.className = "project-tab-strip-scroll";

    this.nav = document.createElement("div");
    this.nav.className = "project-tab-strip-nav";
    const scrollLeftButton = this._buildNavButton("◂", "Desplazar pestañas a la izquierda", -NAV_SCROLL_STEP);
    const scrollRightButton = this._buildNavButton("▸", "Desplazar pestañas a la derecha", NAV_SCROLL_STEP);
    this.nav.append(scrollLeftButton, scrollRightButton);

    this.root.append(this.scrollArea, this.nav);
    this.container.appendChild(this.root);

    this._wireWheelPan();
    this._wireDragPan();
    this._wireReorderDrag();

    this._unsubscribe = projectStore.subscribe(() => this._render());
    this._render();
  }

  /** Unsubscribes from the store and removes the document-level drag
   * listeners. Call when the strip itself is torn down. */
  destroy() {
    this._unsubscribe?.();
    this._unwireDragPan?.();
    this._unwireReorderDrag?.();
  }

  /** @param {string} glyph @param {string} label @param {number} delta */
  _buildNavButton(glyph, label, delta) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "project-tab-strip-nav-btn";
    button.textContent = glyph;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", () => {
      this.scrollArea.scrollLeft += delta;
    });
    return button;
  }

  /** Converts a plain vertical wheel scroll (deltaY, no deltaX) into
   * horizontal panning. A real trackpad's horizontal swipe already reports
   * deltaX and needs no help — `overflow-x: auto` scrolls it natively. */
  _wireWheelPan() {
    this.scrollArea.addEventListener("wheel", (event) => {
      if (event.deltaX !== 0) return;
      event.preventDefault();
      this.scrollArea.scrollLeft += event.deltaY;
    });
  }

  /** Click-and-drag panning (a desktop "swipe" stand-in — this app has no
   * touchscreen target). Below `DRAG_THRESHOLD_PX` of movement, a
   * mousedown/mouseup pair is left alone as a plain click (open/rename a
   * tab); past it, the resulting click is suppressed for exactly one event
   * so a drag-release never also fires whichever tab the pointer ended up
   * over. */
  _wireDragPan() {
    let dragging = false;
    let dragged = false;
    let startX = 0;
    let startScrollLeft = 0;

    const onMouseDown = (event) => {
      if (event.button !== 0) return;
      dragging = true;
      dragged = false;
      startX = event.clientX;
      startScrollLeft = this.scrollArea.scrollLeft;
    };

    const onMouseMove = (event) => {
      if (!dragging) return;
      const delta = event.clientX - startX;
      if (!dragged && Math.abs(delta) > DRAG_THRESHOLD_PX) {
        dragged = true;
        this.scrollArea.classList.add("dragging");
      }
      if (dragged) this.scrollArea.scrollLeft = startScrollLeft - delta;
    };

    const suppressNextClick = (event) => {
      event.stopPropagation();
      event.preventDefault();
      this.scrollArea.removeEventListener("click", suppressNextClick, true);
    };

    const onMouseUp = () => {
      if (dragging && dragged) {
        this.scrollArea.addEventListener("click", suppressNextClick, true);
      }
      this.scrollArea.classList.remove("dragging");
      dragging = false;
      dragged = false;
    };

    this.scrollArea.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    this._unwireDragPan = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }

  /** Starts a reorder-candidate for `tab`/`button` on the button's own
   * mousedown, unless it originated on the close button or an in-progress
   * rename input (both can be descendants of the tab button — neither
   * should ever start a drag). Always stops propagation FIRST, regardless
   * of that check, so `_wireDragPan`'s strip-panning never engages for a
   * press that started on ANY part of a tab (close button included) — only
   * a press on genuinely empty strip background should pan it. */
  _maybeStartReorder(tab, button, event) {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (event.target.closest(".project-tab-close, .project-tab-rename-input")) return;
    this._reorderCandidate = { tab, button, startX: event.clientX, dragging: false };
  }

  /** @param {number} clientX @param {HTMLElement} excludeButton
   * @returns {number} how many of the OTHER tab buttons' midpoints `clientX`
   * has moved past — exactly the index `ProjectSession::reorder`/
   * `project_reorder_tab` expects (computed against the list with the
   * dragged tab already removed, same as the backend's own `Vec::insert`
   * semantics). */
  _dropIndexFor(clientX, excludeButton) {
    const siblings = [...this.scrollArea.children].filter((el) => el !== excludeButton);
    for (let i = 0; i < siblings.length; i++) {
      const rect = siblings[i].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) return i;
    }
    return siblings.length;
  }

  /** Click-and-hold a tab, then move left/right to reposition it in the
   * strip. Below `DRAG_THRESHOLD_PX`, a mousedown/mouseup pair on a tab is
   * left alone as its normal click (activate/open) — same threshold
   * discipline as `_wireDragPan`. */
  _wireReorderDrag() {
    const onMouseMove = (event) => {
      const state = this._reorderCandidate;
      if (!state) return;
      const delta = event.clientX - state.startX;
      if (!state.dragging && Math.abs(delta) > DRAG_THRESHOLD_PX) {
        state.dragging = true;
        state.button.classList.add("reordering");
      }
      if (state.dragging) state.button.style.transform = `translateX(${delta}px)`;
    };

    const onMouseUp = (event) => {
      const state = this._reorderCandidate;
      this._reorderCandidate = null;
      if (!state) return;
      state.button.classList.remove("reordering");
      state.button.style.transform = "";
      if (!state.dragging) return;

      const toIndex = this._dropIndexFor(event.clientX, state.button);
      this.projectStore.reorderTab(state.tab.id, toIndex);

      // One-shot suppression (same pattern as `_wireDragPan`'s
      // `suppressNextClick`) — dropping a dragged tab must never also fire
      // its own "activate" click.
      const suppressClick = (clickEvent) => {
        clickEvent.stopPropagation();
        clickEvent.preventDefault();
        state.button.removeEventListener("click", suppressClick, true);
      };
      state.button.addEventListener("click", suppressClick, true);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    this._unwireReorderDrag = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
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
    this.scrollArea.innerHTML = "";
    for (const tab of this.projectStore.tabs) {
      this.scrollArea.appendChild(this._buildTabButton(tab));
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

    button.addEventListener("mousedown", (event) => this._maybeStartReorder(tab, button, event));
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
