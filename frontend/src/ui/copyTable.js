// Shared "copy table" behavior for every table view (FA/Mealy/Moore/PDA/TM):
// each view's states table has a bulk-select checkbox column
// (`table-col-narrow`) that has nothing useful to paste into a spreadsheet,
// so it's skipped by default rather than exported as an empty column that
// shifts every other one over.

/**
 * Serializes a table's visible content as tab-separated text.
 * @param {HTMLTableElement} table
 * @param {{skipClass?: string}} [opts]
 */
export function tableToTsv(table, { skipClass = "table-col-narrow" } = {}) {
  const lines = [];
  for (const row of table.rows) {
    const cells = [];
    for (const cell of row.cells) {
      if (cell.classList.contains(skipClass)) continue;
      cells.push(cellText(cell));
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

/** Every editable table cell holds its value in an `<input>`, not the
 * cell's own textContent — so read the field's value when one is present. */
function cellText(cell) {
  const field = cell.querySelector("input, select, textarea");
  if (field) return field.value ?? "";
  return cell.textContent.trim();
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Two overlapping rounded squares — a generic "copy/duplicate" glyph, drawn
 * inline (no icon font/asset dependency) so it inherits the button's text
 * color via `currentColor` in both themes. */
function copyIcon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const back = document.createElementNS(SVG_NS, "rect");
  back.setAttribute("x", "3");
  back.setAttribute("y", "3");
  back.setAttribute("width", "13");
  back.setAttribute("height", "13");
  back.setAttribute("rx", "2");

  const front = document.createElementNS(SVG_NS, "rect");
  front.setAttribute("x", "8");
  front.setAttribute("y", "8");
  front.setAttribute("width", "13");
  front.setAttribute("height", "13");
  front.setAttribute("rx", "2");

  svg.append(back, front);
  return svg;
}

/** A checkmark, swapped in for `copyIcon()` briefly after a successful copy
 * — the button has no text label to flash a "¡Copiado!" onto instead. */
function checkIcon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M20 6 9 17l-5-5");
  svg.appendChild(path);
  return svg;
}

/**
 * An icon-only "copy table" button wired to `navigator.clipboard.writeText`.
 * Takes a getter rather than the table element itself because every table
 * view builds its actions bar (where this button lives) before the table
 * element it needs to read from exists yet. `label` drives the accessible
 * name (`title`/`aria-label`) since the button shows only the icon.
 * @param {() => HTMLTableElement} getTable
 * @param {{skipClass?: string, label?: string}} [opts]
 */
export function createCopyTableButton(getTable, { skipClass, label = "Copiar tabla" } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn-secondary btn-icon";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.appendChild(copyIcon());

  button.addEventListener("click", async () => {
    const text = tableToTsv(getTable(), { skipClass });
    try {
      await navigator.clipboard.writeText(text);
      flash(button, checkIcon(), "¡Copiado!", label);
    } catch {
      flash(button, copyIcon(), "No se pudo copiar", label);
    }
  });
  return button;
}

function flash(button, icon, temporaryLabel, originalLabel) {
  button.replaceChildren(icon);
  button.title = temporaryLabel;
  button.setAttribute("aria-label", temporaryLabel);
  setTimeout(() => {
    button.replaceChildren(copyIcon());
    button.title = originalLabel;
    button.setAttribute("aria-label", originalLabel);
  }, 1200);
}
