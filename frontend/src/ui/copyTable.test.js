import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCopyButton, createCopyImageButton, createCopyTableButton, tableToTsv } from "./copyTable.js";

/** Builds a table shaped like the real table views: a narrow selection
 * column (checkbox, `table-col-narrow`), a name column driven by an
 * `<input>` (textContent alone would be empty), and a plain-text header. */
function buildSampleTable() {
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const selectTh = document.createElement("th");
  selectTh.className = "table-col-narrow";
  selectTh.textContent = "";
  const nameTh = document.createElement("th");
  nameTh.textContent = "Estado";
  const symbolTh = document.createElement("th");
  symbolTh.textContent = "a";
  headRow.append(selectTh, nameTh, symbolTh);
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  const row = document.createElement("tr");
  const selectTd = document.createElement("td");
  selectTd.className = "table-col-narrow";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  selectTd.appendChild(checkbox);
  const nameTd = document.createElement("td");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = "->q0";
  nameTd.appendChild(nameInput);
  const cellTd = document.createElement("td");
  const cellInput = document.createElement("input");
  cellInput.type = "text";
  cellInput.value = "q1, q2";
  cellTd.appendChild(cellInput);
  row.append(selectTd, nameTd, cellTd);
  tbody.appendChild(row);

  table.append(thead, tbody);
  return table;
}

describe("tableToTsv", () => {
  it("omits any column marked with the skip class", () => {
    const text = tableToTsv(buildSampleTable());
    for (const line of text.split("\n")) {
      expect(line.split("\t")).toHaveLength(2);
    }
  });

  it("reads input values instead of empty textContent", () => {
    const text = tableToTsv(buildSampleTable());
    const [, dataLine] = text.split("\n");
    expect(dataLine).toBe("->q0\tq1, q2");
  });

  it("falls back to textContent for plain cells (e.g. header labels)", () => {
    const text = tableToTsv(buildSampleTable());
    const [headerLine] = text.split("\n");
    expect(headerLine).toBe("Estado\ta");
  });

  it("respects a custom skip class instead of the default", () => {
    const table = buildSampleTable();
    table.rows[0].cells[1].classList.add("custom-skip");
    const text = tableToTsv(table, { skipClass: "custom-skip" });
    // The default `table-col-narrow` header cell is no longer skipped once
    // a custom class is given, so its (empty) text still occupies a column.
    expect(text.split("\n")[0]).toBe("\ta");
  });
});

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("createCopyImageButton", () => {
  let blob;

  beforeEach(() => {
    blob = new Blob(["png"], { type: "image/png" });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rasterizes the SVG and puts the PNG on the clipboard", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const rasterize = vi.fn().mockResolvedValue(blob);
    const copyImage = vi.fn().mockResolvedValue(undefined);
    const button = createCopyImageButton(() => svg, { rasterize, copyImage, label: "Copiar árbol como imagen" });
    button.click();
    await flush();
    expect(rasterize).toHaveBeenCalledWith(svg);
    expect(copyImage).toHaveBeenCalledWith(blob);
    expect(button.title).toBe("¡Copiado!");
  });

  it("downloads the PNG when the clipboard cannot take images", async () => {
    const rasterize = vi.fn().mockResolvedValue(blob);
    const copyImage = vi.fn().mockRejectedValue(new Error("sin soporte"));
    const download = vi.fn();
    const button = createCopyImageButton(() => null, { rasterize, copyImage, download, filename: "arbol.png" });
    button.click();
    await flush();
    expect(download).toHaveBeenCalledWith(blob, "arbol.png");
    expect(button.title).toBe("Imagen descargada");
  });

  it("reports a failure to rasterize without trying to copy", async () => {
    const rasterize = vi.fn().mockRejectedValue(new Error("sin canvas"));
    const copyImage = vi.fn();
    const button = createCopyImageButton(() => null, { rasterize, copyImage });
    button.click();
    await flush();
    expect(copyImage).not.toHaveBeenCalled();
    expect(button.title).toBe("No se pudo generar la imagen");
  });

  it("is icon-only, with the label carried by title/aria-label instead of text", () => {
    const button = createCopyImageButton(() => null);
    expect(button.textContent.trim()).toBe("");
    expect(button.querySelector("svg")).toBeTruthy();
    expect(button.title).toBe("Copiar imagen");
    expect(button.getAttribute("aria-label")).toBe("Copiar imagen");
  });
});

describe("createCopyButton", () => {
  let writeText;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("copies whatever getText returns, read lazily at click time", async () => {
    const getText = vi.fn().mockReturnValue("primera línea\nsegunda línea");
    const button = createCopyButton(getText, { label: "Copiar árbol" });
    expect(button.title).toBe("Copiar árbol");
    await button.dispatchEvent(new Event("click"));
    expect(writeText).toHaveBeenCalledWith("primera línea\nsegunda línea");
    expect(button.title).toBe("¡Copiado!");
  });
});

describe("createCopyTableButton", () => {
  let writeText;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("copies the current table's TSV, read lazily at click time", async () => {
    const table = buildSampleTable();
    const button = createCopyTableButton(() => table);
    await button.dispatchEvent(new Event("click"));
    expect(writeText).toHaveBeenCalledWith("Estado\ta\n->q0\tq1, q2");
  });

  it("is icon-only, with the label carried by title/aria-label instead of text", () => {
    const table = buildSampleTable();
    const button = createCopyTableButton(() => table, { label: "Copiar tabla" });
    expect(button.textContent.trim()).toBe("");
    expect(button.querySelector("svg")).toBeTruthy();
    expect(button.title).toBe("Copiar tabla");
    expect(button.getAttribute("aria-label")).toBe("Copiar tabla");
  });

  it("flashes a confirmation label then reverts", async () => {
    const table = buildSampleTable();
    const button = createCopyTableButton(() => table, { label: "Copiar tabla" });
    await button.dispatchEvent(new Event("click"));
    expect(button.title).toBe("¡Copiado!");
    expect(button.getAttribute("aria-label")).toBe("¡Copiado!");
    vi.advanceTimersByTime(1200);
    expect(button.title).toBe("Copiar tabla");
    expect(button.getAttribute("aria-label")).toBe("Copiar tabla");
    expect(button.querySelector("svg")).toBeTruthy();
  });
});
