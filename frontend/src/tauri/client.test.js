import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Tauri v2 core `invoke` — same technique as `ui/nativeDialog.test.js`
// uses for the dialog plugin. `client.js` imports `@tauri-apps/api/core`
// lazily (dynamic `import()`), but `vi.mock` intercepts the module
// regardless of when it's actually imported.
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args) => invoke(...args) }));

const client = await import("./client.js");

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ tabs: [], revision: 0 });
});

describe("client.js project command wrappers (PR9, design D8/D14)", () => {
  it("projectNew() calls invoke with project_new and no tabId", async () => {
    await client.projectNew();
    expect(invoke).toHaveBeenCalledWith("project_new", undefined);
  });

  it("projectManifest() calls invoke with project_manifest and no tabId", async () => {
    await client.projectManifest();
    expect(invoke).toHaveBeenCalledWith("project_manifest", undefined);
  });

  it("projectNewTab(kind, name) calls invoke with project_new_tab and {kind, name}", async () => {
    await client.projectNewTab("Fa", "My FA");
    expect(invoke).toHaveBeenCalledWith("project_new_tab", { kind: "Fa", name: "My FA" });
  });

  it("projectCloseTab(tabId) calls invoke with project_close_tab and {tabId}", async () => {
    await client.projectCloseTab(3);
    expect(invoke).toHaveBeenCalledWith("project_close_tab", { tabId: 3 });
  });

  it("projectRenameTab(tabId, newName) calls invoke with project_rename_tab and {tabId, newName}", async () => {
    await client.projectRenameTab(3, "Renamed");
    expect(invoke).toHaveBeenCalledWith("project_rename_tab", { tabId: 3, newName: "Renamed" });
  });

  it("projectReorderTab(tabId, toIndex) calls invoke with project_reorder_tab and {tabId, toIndex}", async () => {
    await client.projectReorderTab(3, 1);
    expect(invoke).toHaveBeenCalledWith("project_reorder_tab", { tabId: 3, toIndex: 1 });
  });

  it("projectOpen(path) calls invoke with project_open and {path}", async () => {
    await client.projectOpen("/tmp/project.jflapproj");
    expect(invoke).toHaveBeenCalledWith("project_open", { path: "/tmp/project.jflapproj" });
  });

  it("projectSave(path) calls invoke with project_save and {path}", async () => {
    await client.projectSave("/tmp/project.jflapproj");
    expect(invoke).toHaveBeenCalledWith("project_save", { path: "/tmp/project.jflapproj" });
  });

  it("resolves with whatever invoke resolves to (the ProjectManifest)", async () => {
    const manifest = { tabs: [{ id: 0, kind: "Fa", name: "A", revision: 0 }], revision: 0 };
    invoke.mockResolvedValue(manifest);
    await expect(client.projectManifest()).resolves.toEqual(manifest);
  });
});

describe("client.js tabId plumbing on existing per-kind wrappers (PR9, design D14)", () => {
  it("docApply(ops, tabId) forwards tabId alongside ops", async () => {
    await client.docApply([{ op: "AddState" }], 7);
    expect(invoke).toHaveBeenCalledWith("doc_apply", { ops: [{ op: "AddState" }], tabId: 7 });
  });

  it("docSnapshot() omitted tabId forwards tabId: undefined (server defaults to the seeded tab)", async () => {
    await client.docSnapshot();
    expect(invoke).toHaveBeenCalledWith("doc_snapshot", { tabId: undefined });
  });

  it("pdaSim(input, acceptBy, budget, tabId) forwards every argument by name", async () => {
    await client.pdaSim(["a"], "empty", { max_steps: 10 }, 2);
    expect(invoke).toHaveBeenCalledWith("pda_sim", {
      input: ["a"],
      acceptBy: "empty",
      budget: { max_steps: 10 },
      tabId: 2,
    });
  });

  it("tmSim(inputs, acceptBy, budget, tabId) forwards every argument by name", async () => {
    await client.tmSim([["a"]], "halting", undefined, 5);
    expect(invoke).toHaveBeenCalledWith("tm_sim", {
      inputs: [["a"]],
      acceptBy: "halting",
      budget: undefined,
      tabId: 5,
    });
  });
});
