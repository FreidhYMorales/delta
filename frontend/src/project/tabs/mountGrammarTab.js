// Mounts one "Gramática" project tab: a grammar editor and its analysis
// (`GrammarTabView`) over the tab's own document (`GrammarDocStore`). No
// diagram, toolbar or kind-specific menus — a grammar is text, not a
// machine — but the same handle shape as the machine tabs, so `TabHost`
// and the tab strip treat it like any other tab.

import { GrammarDocStore } from "../../store/GrammarDocStore.js";
import { GrammarTabView } from "../../views/grammarTab/GrammarTabView.js";

/**
 * @param {number} tabId
 * @param {{contentHost: HTMLElement, toolbarHost: HTMLElement}} hosts
 * @param {typeof import('../../tauri/client.js')} client
 * @param {{projectStore?: import('../ProjectStore.js').ProjectStore}} [collaborators]
 */
export function mountGrammarTab(tabId, hosts, client, collaborators = {}) {
  const { projectStore } = collaborators;

  const root = document.createElement("div");
  root.className = "app-body grammar-body";
  root.hidden = true;
  hosts.contentHost.appendChild(root);

  const store = new GrammarDocStore(client, tabId);
  store.subscribe(() => projectStore?.updateTabRevision?.(tabId, store.revision));
  new GrammarTabView(root, store);
  store.load();

  return {
    tabId,
    kind: "Grammar",
    root,
    store,
    activate() {
      root.hidden = false;
    },
    deactivate() {
      root.hidden = true;
    },
    destroy() {
      root.remove();
    },
  };
}
