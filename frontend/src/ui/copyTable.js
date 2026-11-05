// Shared "copy" behavior for every table view (FA/Mealy/Moore/PDA/TM) and
// for anything else that needs it (the ER → AFD syntax tree): a table's bulk-
// select checkbox column (`table-col-narrow`) has nothing useful to paste
// into a spreadsheet, so it's skipped by default rather than exported as an
// empty column that shifts every other one over.

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

/** A framed picture — marks the button that copies a PNG, next to the plain
 * copy icon used for text. */
function imageIcon() {
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

  const frame = document.createElementNS(SVG_NS, "rect");
  frame.setAttribute("x", "3");
  frame.setAttribute("y", "4");
  frame.setAttribute("width", "18");
  frame.setAttribute("height", "16");
  frame.setAttribute("rx", "2");

  const sun = document.createElementNS(SVG_NS, "circle");
  sun.setAttribute("cx", "8.5");
  sun.setAttribute("cy", "9.5");
  sun.setAttribute("r", "1.5");

  const hills = document.createElementNS(SVG_NS, "path");
  hills.setAttribute("d", "m21 15-4.5-4.5L7 20");

  svg.append(frame, sun, hills);
  return svg;
}

/**
 * An icon-only "copy" button wired to `navigator.clipboard.writeText`, for
 * anything whose text isn't a table (the ER → AFD syntax tree). Takes a
 * getter rather than the text itself because the button is built before the
 * content it reads from exists (or before it changes). `label` drives the
 * accessible name (`title`/`aria-label`) since the button shows only the icon.
 * @param {() => string} getText
 * @param {{label?: string}} [opts]
 */
export function createCopyButton(getText, { label = "Copiar" } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn-secondary btn-icon";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.appendChild(copyIcon());

  button.addEventListener("click", async () => {
    const text = getText();
    try {
      await navigator.clipboard.writeText(text);
      flash(button, checkIcon(), "¡Copiado!", label);
    } catch {
      flash(button, copyIcon(), "No se pudo copiar", label);
    }
  });
  return button;
}

/**
 * An icon-only "copy table" button: `createCopyButton` reading the table's
 * TSV at click time. See `tableToTsv` for what is copied.
 * @param {() => HTMLTableElement} getTable
 * @param {{skipClass?: string, label?: string}} [opts]
 */
export function createCopyTableButton(getTable, { skipClass, label = "Copiar tabla" } = {}) {
  return createCopyButton(() => tableToTsv(getTable(), { skipClass }), { label });
}

/**
 * An icon-only button that rasterizes an SVG to PNG and puts it on the
 * clipboard, for things that are only useful as a picture (a syntax tree too
 * wide to screenshot). If the clipboard refuses images — some WebViews don't
 * implement `ClipboardItem` — the PNG is downloaded instead, so the tree is
 * never lost. All collaborators are injectable so this can be tested without
 * a canvas.
 * @param {() => SVGSVGElement} getSvg
 * @param {{label?: string, filename?: string, rasterize?: (svg: SVGSVGElement) => Promise<Blob>, copyImage?: (blob: Blob) => Promise<void>, download?: (blob: Blob, filename: string) => void}} [opts]
 */
export function createCopyImageButton(
  getSvg,
  {
    label = "Copiar imagen",
    filename = "arbol.png",
    rasterize = svgToPngBlob,
    copyImage = copyImageToClipboard,
    download = downloadBlob,
  } = {},
) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn-secondary btn-icon";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.appendChild(imageIcon());

  button.addEventListener("click", async () => {
    let blob;
    try {
      blob = await rasterize(getSvg());
    } catch {
      flash(button, imageIcon(), "No se pudo generar la imagen", label, imageIcon());
      return;
    }
    try {
      await copyImage(blob);
      flash(button, checkIcon(), "¡Copiado!", label, imageIcon());
    } catch {
      try {
        download(blob, filename);
        flash(button, imageIcon(), "Imagen descargada", label, imageIcon());
      } catch {
        flash(button, imageIcon(), "No se pudo copiar", label, imageIcon());
      }
    }
  });
  return button;
}

const MAX_IMAGE_SIDE = 8192;

/**
 * Rasterizes an SVG element to a PNG blob at up to 2x, scaled down when the
 * tree is so wide it would exceed the browser's canvas limits. The page's
 * computed colors are copied onto the clone: an SVG loaded through an
 * `<img>`/blob URL cannot see the page's CSS or variables, so without this
 * the image would come out black-on-transparent.
 * @param {SVGSVGElement} svg
 * @returns {Promise<Blob>}
 */
export async function svgToPngBlob(svg) {
  const box = svg.getBoundingClientRect?.();
  const width = Number(svg.getAttribute("width")) || box?.width || 0;
  const height = Number(svg.getAttribute("height")) || box?.height || 0;
  if (!width || !height) throw new Error("El árbol no tiene tamaño");
  const scale = Math.min(2, MAX_IMAGE_SIDE / Math.max(width, height));

  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", SVG_NS);
  inlineComputedStyles(svg, clone);

  const source = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No hay canvas disponible");
    context.fillStyle = pageBackground();
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const COPIED_STYLE_PROPERTIES = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "font-family",
  "font-size",
  "font-weight",
];

function inlineComputedStyles(source, clone) {
  const originals = [source, ...source.querySelectorAll("*")];
  const copies = [clone, ...clone.querySelectorAll("*")];
  originals.forEach((element, i) => {
    const computed = getComputedStyle(element);
    for (const property of COPIED_STYLE_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value) copies[i].setAttribute(property, value);
    }
  });
}

function pageBackground() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim();
  return value || "#ffffff";
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo dibujar el árbol"));
    image.src = url;
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No se pudo generar el PNG"))), "image/png");
  });
}

async function copyImageToClipboard(blob) {
  const ClipboardItemCtor = globalThis.ClipboardItem;
  if (!ClipboardItemCtor || !navigator.clipboard?.write) throw new Error("El portapapeles no acepta imágenes");
  await navigator.clipboard.write([new ClipboardItemCtor({ "image/png": blob })]);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function flash(button, icon, temporaryLabel, originalLabel, restoreIcon = copyIcon()) {
  button.replaceChildren(icon);
  button.title = temporaryLabel;
  button.setAttribute("aria-label", temporaryLabel);
  setTimeout(() => {
    button.replaceChildren(restoreIcon);
    button.title = originalLabel;
    button.setAttribute("aria-label", originalLabel);
  }, 1200);
}
