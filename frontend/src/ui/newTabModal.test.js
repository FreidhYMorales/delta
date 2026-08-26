import { beforeEach, describe, expect, it } from "vitest";
import { newTabModal } from "./newTabModal.js";

const KINDS = [
  { id: "Fa", label: "Autómata Finito" },
  { id: "Mealy", label: "Máquina de Mealy" },
];

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("newTabModal (kind + name — replaces the old one-entry-per-kind 'Nuevo: <kind>' menu design)", () => {
  it("renders a kind select (one option per kind, in order) and a name input", () => {
    newTabModal(KINDS);
    const select = document.querySelector(".new-tab-modal-kind");
    expect(select).not.toBeNull();
    expect([...select.options].map((o) => ({ value: o.value, label: o.textContent }))).toEqual([
      { value: "Fa", label: "Autómata Finito" },
      { value: "Mealy", label: "Máquina de Mealy" },
    ]);
    expect(document.querySelector(".new-tab-modal-name")).not.toBeNull();
    expect(document.querySelector(".new-tab-modal-ok")).not.toBeNull();
    expect(document.querySelector(".new-tab-modal-cancel")).not.toBeNull();
  });

  it("defaults the kind select to the first kind in the list", () => {
    newTabModal(KINDS);
    expect(document.querySelector(".new-tab-modal-kind").value).toBe("Fa");
  });

  it("resolves {kind, name} when Aceptar is clicked with a chosen kind and a typed name", async () => {
    const result = newTabModal(KINDS);
    document.querySelector(".new-tab-modal-kind").value = "Mealy";
    document.querySelector(".new-tab-modal-name").value = "Mi máquina";
    document.querySelector(".new-tab-modal-ok").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(await result).toEqual({ kind: "Mealy", name: "Mi máquina" });
  });

  it("does not resolve when Aceptar is clicked with a blank name (stays open)", async () => {
    let settled = false;
    const result = newTabModal(KINDS).then((v) => {
      settled = true;
      return v;
    });
    document.querySelector(".new-tab-modal-ok").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(document.querySelector(".new-tab-modal-overlay")).not.toBeNull();

    document.querySelector(".new-tab-modal-name").value = "Ahora sí";
    document.querySelector(".new-tab-modal-ok").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(await result).toEqual({ kind: "Fa", name: "Ahora sí" });
  });

  it("resolves null when Cancelar is clicked", async () => {
    const result = newTabModal(KINDS);
    document.querySelector(".new-tab-modal-name").value = "Descartado";
    document.querySelector(".new-tab-modal-cancel").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(await result).toBeNull();
  });

  it("resolves null on Escape, same as clicking Cancelar", async () => {
    const result = newTabModal(KINDS);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await result).toBeNull();
  });

  it("resolves null when clicking the backdrop outside the modal box", async () => {
    const result = newTabModal(KINDS);
    document.querySelector(".new-tab-modal-overlay").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(await result).toBeNull();
  });

  it("removes itself from the DOM once resolved", async () => {
    const result = newTabModal(KINDS);
    document.querySelector(".new-tab-modal-cancel").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await result;

    expect(document.querySelector(".new-tab-modal-overlay")).toBeNull();
  });
});
