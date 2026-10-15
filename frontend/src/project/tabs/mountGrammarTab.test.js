import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountGrammarTab } from "./mountGrammarTab.js";

const analysis = { grammar: null, classification: null, error: { line: 1, message: "vacía" } };

function setup() {
  const client = {
    grammarSnapshot: vi.fn().mockResolvedValue({ revision: 0, source: "S -> a", analysis }),
    grammarSetSource: vi.fn().mockResolvedValue({ revision: 1, source: "S -> b", analysis }),
  };
  const hosts = { contentHost: document.createElement("div"), toolbarHost: document.createElement("div") };
  const projectStore = { updateTabRevision: vi.fn() };
  const mount = mountGrammarTab(5, hosts, client, { projectStore });
  return { client, hosts, projectStore, mount };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("mountGrammarTab", () => {
  it("mounts a hidden Grammar tab and loads its document", async () => {
    const { client, hosts, mount } = setup();
    expect(mount.kind).toBe("Grammar");
    expect(mount.tabId).toBe(5);
    expect(hosts.contentHost.contains(mount.root)).toBe(true);
    expect(mount.root.hidden).toBe(true);
    await mount.store.load();
    expect(client.grammarSnapshot).toHaveBeenCalledWith(5);
    expect(mount.root.querySelector(".grammar-source").value).toBe("S -> a");
  });

  it("reports every revision to the project (unsaved-changes tracking)", async () => {
    const { projectStore, mount } = setup();
    await mount.store.setSource("S -> b");
    expect(projectStore.updateTabRevision).toHaveBeenCalledWith(5, 1);
  });

  it("activate shows it, deactivate hides it, destroy removes it", () => {
    const { hosts, mount } = setup();
    mount.activate();
    expect(mount.root.hidden).toBe(false);
    mount.deactivate();
    expect(mount.root.hidden).toBe(true);
    mount.destroy();
    expect(hosts.contentHost.contains(mount.root)).toBe(false);
  });
});
