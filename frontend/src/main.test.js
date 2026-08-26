import { beforeEach, describe, expect, it, vi } from "vitest";

// `main.js` is the app shell's boot entry point (PR11: app-boot ->
// project_new() -> project_new_tab("Fa", ...) -> mount -> activate). It has
// no injectable seams of its own by design (it's the composition root), so
// this smoke test mocks the ONE thing it imports that would otherwise reach
// a real Tauri webview — `tauri/client.js` — and proves the boot sequence
// actually reaches a rendered, activated Fa tab without throwing.
function emptyFaSnapshot() {
  return { revision: 0, states: [], edges: [], derived: { classification: "Dfa", alphabet: [], unreachable: [] } };
}

vi.mock("./tauri/client.js", () => ({
  docSnapshot: vi.fn().mockResolvedValue(emptyFaSnapshot()),
  docApply: vi.fn(),
  docUndo: vi.fn(),
  docRedo: vi.fn(),
  docOpen: vi.fn(),
  docSave: vi.fn(),
  simTrace: vi.fn(),
  simBatch: vi.fn(),
  jffImport: vi.fn(),
  jffExport: vi.fn(),
  convToRegex: vi.fn(),
  convFromRegex: vi.fn(),
  convToGrammar: vi.fn(),
  convFromGrammar: vi.fn(),
  convNfaToDfa: vi.fn(),
  convMinimizeDfa: vi.fn(),
  projectNew: vi.fn().mockResolvedValue({ tabs: [], revision: 0 }),
  projectManifest: vi.fn().mockResolvedValue({ tabs: [], revision: 0 }),
  projectNewTab: vi.fn().mockResolvedValue({
    tabs: [{ id: 0, kind: "Fa", name: "Autómata Finito 1", revision: 0 }],
    revision: 0,
  }),
  projectCloseTab: vi.fn(),
  projectRenameTab: vi.fn(),
  projectOpen: vi.fn(),
  projectSave: vi.fn(),
}));

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  vi.resetModules();
});

describe("main.js app boot (PR11: project_new -> project_new_tab('Fa', ...) -> mount -> activate)", () => {
  it("boots into exactly one active, visible Fa tab with its own toolbar and a composed menu bar", async () => {
    await import("./main.js");
    // Flush the boot sequence's pending promise chain.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const app = document.querySelector("#app");
    expect(app.querySelector(".project-tab-strip")).not.toBeNull();
    expect(app.querySelectorAll(".project-tab").length).toBe(1);

    const visibleAppBodies = [...app.querySelectorAll(".app-body")].filter((el) => !el.hidden);
    expect(visibleAppBodies.length).toBe(1);

    const visibleToolbars = [...app.querySelectorAll(".toolbar")].filter((el) => !el.hidden);
    expect(visibleToolbars.length).toBe(1);

    const menuTriggers = [...app.querySelectorAll(".menu-bar-item")].map((b) => b.textContent);
    expect(menuTriggers).toEqual(["Archivo", "Editar", "Ver", "Convertir", "Test"]);
  });
});
