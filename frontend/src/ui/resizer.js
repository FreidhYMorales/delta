// Draggable divider between the canvas pane and the right column (main.js
// shell) — layout plan agreed with the user: 60/40 default, resizable so a
// large state table has somewhere to grow into.

/** Pure: clamp a raw canvas-pane width percentage into the allowed range. */
export function clampPaneWidth(percent, min = 35, max = 70) {
  return Math.max(min, Math.min(max, percent));
}

/**
 * Wires pointer-drag resizing: dragging `resizer` sets `pane`'s
 * `flex-basis` to the pointer's horizontal position within `bounds`, as a
 * percentage of `bounds`'s width, clamped via `clampPaneWidth`.
 * @param {HTMLElement} resizer
 * @param {HTMLElement} bounds the flex container both `pane` and `resizer` live in
 * @param {HTMLElement} pane the element whose flex-basis gets resized
 * @param {{min?: number, max?: number}} [opts]
 */
export function wireResizer(resizer, bounds, pane, { min = 35, max = 70 } = {}) {
  let dragging = false;

  resizer.addEventListener("pointerdown", (event) => {
    dragging = true;
    resizer.classList.add("dragging");
    resizer.setPointerCapture(event.pointerId);
  });

  resizer.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const rect = bounds.getBoundingClientRect();
    const raw = ((event.clientX - rect.left) / rect.width) * 100;
    pane.style.flexBasis = `${clampPaneWidth(raw, min, max)}%`;
  });

  const stop = () => {
    dragging = false;
    resizer.classList.remove("dragging");
  };
  resizer.addEventListener("pointerup", stop);
  resizer.addEventListener("pointercancel", stop);
}
