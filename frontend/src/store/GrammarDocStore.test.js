import { describe, expect, it, vi } from "vitest";
import { GrammarDocStore } from "./GrammarDocStore.js";

const snap = (source, revision) => ({ revision, source, analysis: { grammar: null, classification: null, error: null } });

function setup() {
  const client = {
    grammarSnapshot: vi.fn().mockResolvedValue(snap("S -> a", 0)),
    grammarSetSource: vi.fn(async (source) => snap(source, 1)),
  };
  return { client, store: new GrammarDocStore(client, 7) };
}

describe("GrammarDocStore", () => {
  it("loads the tab's snapshot and notifies", async () => {
    const { client, store } = setup();
    const listener = vi.fn();
    store.subscribe(listener);
    await store.load();
    expect(client.grammarSnapshot).toHaveBeenCalledWith(7);
    expect(store.source).toBe("S -> a");
    expect(store.revision).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("setSource sends the text for this tab and adopts the returned snapshot", async () => {
    const { client, store } = setup();
    await store.setSource("S -> b");
    expect(client.grammarSetSource).toHaveBeenCalledWith("S -> b", 7);
    expect(store.source).toBe("S -> b");
    expect(store.revision).toBe(1);
  });

  it("ignores a stale response that resolves after a newer one", async () => {
    const { client, store } = setup();
    let releaseFirst;
    client.grammarSetSource
      .mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = () => resolve(snap("S -> old", 1)))))
      .mockImplementationOnce(async () => snap("S -> new", 2));
    const first = store.setSource("S -> old");
    await store.setSource("S -> new");
    releaseFirst();
    await first;
    expect(store.source).toBe("S -> new");
    expect(store.revision).toBe(2);
  });
});
