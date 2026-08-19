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
 * @returns {{panels: Map<string, HTMLElement>, select: (id: string) => void, selected: () => string|null}}
 */
export function createTabs(container, tabs) {
  const strip = document.createElement("div");
  strip.className = "tabs";
  strip.setAttribute("role", "tablist");

  const panelsWrap = document.createElement("div");
  panelsWrap.className = "tab-panels";

  const buttons = new Map();
  const panels = new Map();
  let current = tabs[0]?.id ?? null;

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

  function select(id) {
    if (!panels.has(id) || id === current) return;
    current = id;
    for (const [tabId, button] of buttons) button.classList.toggle("active", tabId === id);
    for (const [tabId, panel] of panels) panel.classList.toggle("active", tabId === id);
  }

  // Apply the initial selection's active classes without the `id === current`
  // short-circuit above skipping it.
  for (const [tabId, button] of buttons) button.classList.toggle("active", tabId === current);
  for (const [tabId, panel] of panels) panel.classList.toggle("active", tabId === current);

  return { panels, select, selected: () => current };
}
