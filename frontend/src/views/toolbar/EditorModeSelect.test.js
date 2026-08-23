import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../../store/DocStore.js";
import { ViewContext } from "../../commands/context.js";
import { EditorModeSelect } from "./EditorModeSelect.js";

function setup(hooks = {}) {
  const client = { docSnapshot: vi.fn(), docApply: vi.fn(), docUndo: vi.fn(), docRedo: vi.fn() };
  const docStore = new DocStore(client);
  const ctx = new ViewContext(docStore);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const modeSelect = new EditorModeSelect(container, ctx, hooks);
  return { ctx, container, modeSelect };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("EditorModeSelect", () => {
  it("renders Autómata Finito, Máquina de Mealy, Máquina de Moore and Autómata de Pila enabled, right after each other, Turing disabled", () => {
    const { container } = setup();
    const select = container.querySelector("select");
    const options = [...select.querySelectorAll("option")];
    expect(options.map((o) => o.textContent)).toEqual([
      "Autómata Finito",
      "Máquina de Mealy",
      "Máquina de Moore",
      "Autómata de Pila",
      "Máquina de Turing — próximamente",
      "Expresión Regular",
      "Gramática Regular",
    ]);
    expect(options.map((o) => o.disabled)).toEqual([false, false, false, false, true, false, false]);
  });

  it("selecting 'Autómata de Pila' calls onSwitchMode('pda') and stays selected (a real mode, not a jump)", () => {
    const onSwitchMode = vi.fn();
    const { container } = setup({ onSwitchMode });
    const select = container.querySelector("select");

    select.value = "pda";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onSwitchMode).toHaveBeenCalledWith("pda");
    expect(select.value).toBe("pda");
  });

  it("selecting 'Máquina de Moore' calls onSwitchMode('moore') and stays selected (a real mode, not a jump)", () => {
    const onSwitchMode = vi.fn();
    const { container } = setup({ onSwitchMode });
    const select = container.querySelector("select");

    select.value = "moore";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onSwitchMode).toHaveBeenCalledWith("moore");
    expect(select.value).toBe("moore");
  });

  it("selecting 'Máquina de Mealy' calls onSwitchMode('mealy') and stays selected (a real mode, not a jump)", () => {
    const onSwitchMode = vi.fn();
    const { container } = setup({ onSwitchMode });
    const select = container.querySelector("select");

    select.value = "mealy";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onSwitchMode).toHaveBeenCalledWith("mealy");
    expect(select.value).toBe("mealy");
  });

  it("selecting 'Autómata Finito' (switching back) calls onSwitchMode('finite')", () => {
    const onSwitchMode = vi.fn();
    const { container } = setup({ onSwitchMode });
    const select = container.querySelector("select");
    select.value = "mealy";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    onSwitchMode.mockClear();

    select.value = "finite";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onSwitchMode).toHaveBeenCalledWith("finite");
  });

  it("selecting 'Expresión Regular' still jumps there via the registry action, then resets to Autómata Finito", () => {
    const { container, ctx } = setup();
    const openRegexTab = vi.fn();
    ctx.openRegexTab = openRegexTab;
    const select = container.querySelector("select");

    select.value = "editor.openRegex";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(openRegexTab).toHaveBeenCalled();
    expect(select.value).toBe("finite");
  });

  it("selecting 'Gramática Regular' still jumps there via the registry action, then resets to Autómata Finito", () => {
    const { container, ctx } = setup();
    const openGrammarTab = vi.fn();
    ctx.openGrammarTab = openGrammarTab;
    const select = container.querySelector("select");

    select.value = "editor.openGrammar";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(openGrammarTab).toHaveBeenCalled();
    expect(select.value).toBe("finite");
  });
});
