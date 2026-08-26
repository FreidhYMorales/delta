// Minimal tab strip: one row of buttons, one panel visible at a time.
// Reused by both right-column panels (Tabla de estados/Definición formal on
// top, Cadena/Lote/Resultados below — see the layout plan agreed with the
// user) instead of writing the same show/hide bookkeeping twice. Plain
// DOM/CSS, same vanilla-JS style as promptModal.js/notice.js — `select` is
// exposed so a caller can switch tabs programmatically (the testing view's
// "Calcular" button jumping to "Resultados").

/**
 * @param {HTMLElement} container appended into; gets a `.tabs` strip + a `.tab-panels` wrapper
 * @param {{id: string, label: string}[]} tabs
 * @param {{collapsible?: boolean, onCollapsedChange?: (collapsed: boolean) => void}} [options]
 *   `collapsible`: re-clicking the already-active tab hides `.tab-panels`
 *   while leaving the `.tabs` strip itself in place (`container` gets a
 *   `tabs-collapsed` class a caller can style against — e.g. shrinking a
 *   flex sibling down to just its strip so the OTHER stacked panel can grow
 *   into the freed space); clicking any tab while collapsed expands again.
 *   Ignored (default `false`) for ordinary tab groups, which keep their
 *   original behavior: re-clicking the active tab does nothing.
 * @returns {{panels: Map<string, HTMLElement>, select: (id: string) => void, selected: () => string|null, isCollapsed: () => boolean}}
 */
export function createTabs(container, tabs, { collapsible = false, onCollapsedChange } = {}) {
  const strip = document.createElement("div");
  strip.className = "tabs";
  strip.setAttribute("role", "tablist");

  const panelsWrap = document.createElement("div");
  panelsWrap.className = "tab-panels";

  const buttons = new Map();
  const panels = new Map();
  let current = tabs[0]?.id ?? null;
  let collapsed = false;

  for (const tab of tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab";
    button.textContent = tab.label;
    button.setAttribute("role", "tab");
    button.addEventListener("click", () => select(tab.id));
    strip.appendChild(button);
    buttons.set(tab.id, button);

    const panel = document.createElement("div");
    panel.className = "tab-panel";
    panelsWrap.appendChild(panel);
    panels.set(tab.id, panel);
  }

  container.append(strip, panelsWrap);

  function setCollapsed(value) {
    if (collapsed === value) return;
    collapsed = value;
    container.classList.toggle("tabs-collapsed", collapsed);
    onCollapsedChange?.(collapsed);
  }

  function select(id) {
    if (!panels.has(id)) return;
    if (id === current) {
      // Re-clicking the already-active tab only does something for a
      // collapsible group — every other tab group keeps its original
      // no-op behavior here.
      if (collapsible) setCollapsed(!collapsed);
      return;
    }
    if (collapsed) setCollapsed(false);
    current = id;
    for (const [tabId, button] of buttons) button.classList.toggle("active", tabId === id);
    for (const [tabId, panel] of panels) panel.classList.toggle("active", tabId === id);
  }

  // Apply the initial selection's active classes without the `id === current`
  // short-circuit above skipping it.
  for (const [tabId, button] of buttons) button.classList.toggle("active", tabId === current);
  for (const [tabId, panel] of panels) panel.classList.toggle("active", tabId === current);

  return { panels, select, selected: () => current, isCollapsed: () => collapsed };
}
