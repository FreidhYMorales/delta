// Small "hide/show the whole right sidebar" handle docked on the resizer
// (main.js's canvas/right-col split, `ui/resizer.js`) — collapsing it fully
// with no way back would be a dead end, so this leaves one visible affordance
// (a button riding on the resizer itself, always in the same place) to bring
// it back.

/**
 * @param {HTMLElement} resizer the draggable divider (`wireResizer` target) — gets the toggle button appended into it
 * @param {HTMLElement} canvasPane the pane that should take the freed width once the sidebar is hidden
 * @param {HTMLElement} rightCol the sidebar to hide/show
 * @returns {{isCollapsed: () => boolean}}
 */
export function wireSidebarToggle(resizer, canvasPane, rightCol) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sidebar-toggle";
  // A pointerdown reaching the resizer's own drag handler would arm a
  // pointer-capture drag for what the user meant as a plain click.
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  // `.resizer:hover` covers the button too (it's a descendant), turning on
  // the drag divider's own blue hover-accent right behind/around the
  // button's border — this suppresses just that accent while the pointer
  // is actually over the button, not the plain draggable strip.
  button.addEventListener("mouseenter", () => resizer.classList.add("toggle-hover"));
  button.addEventListener("mouseleave", () => resizer.classList.remove("toggle-hover"));
  resizer.appendChild(button);

  let collapsed = false;

  function render() {
    button.textContent = collapsed ? "◂" : "▸";
    const label = collapsed ? "Mostrar panel lateral" : "Ocultar panel lateral";
    button.title = label;
    button.setAttribute("aria-label", label);
    rightCol.classList.toggle("sidebar-hidden", collapsed);
    canvasPane.classList.toggle("canvas-full", collapsed);
  }

  button.addEventListener("click", () => {
    collapsed = !collapsed;
    render();
  });

  render();
  return { isCollapsed: () => collapsed };
}
