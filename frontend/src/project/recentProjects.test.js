import { describe, expect, it } from "vitest";
import { RecentProjects } from "./recentProjects.js";

/** Injectable fake storage (design D13) — a plain in-memory Map behind the
 * exact `getItem`/`setItem` shape `window.localStorage` exposes, so no real
 * localStorage/browser API is needed under Vitest. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
  };
}

describe("RecentProjects.add (D13)", () => {
  it("starts empty", () => {
    const recent = new RecentProjects(fakeStorage());
    expect(recent.list()).toEqual([]);
  });

  it("adds a path to the front of the list", () => {
    const recent = new RecentProjects(fakeStorage());
    recent.add("/a.jflap");
    recent.add("/b.jflap");
    expect(recent.list()).toEqual(["/b.jflap", "/a.jflap"]);
  });

  it("re-adding an existing path moves it to the front without duplicating it", () => {
    const recent = new RecentProjects(fakeStorage());
    recent.add("/a.jflap");
    recent.add("/b.jflap");
    recent.add("/c.jflap");
    recent.add("/a.jflap");

    expect(recent.list()).toEqual(["/a.jflap", "/c.jflap", "/b.jflap"]);
  });

  it("caps the list at 10 entries, dropping the oldest", () => {
    const recent = new RecentProjects(fakeStorage());
    for (let i = 0; i < 12; i++) recent.add(`/p${i}.jflap`);

    const list = recent.list();
    expect(list).toHaveLength(10);
    expect(list[0]).toBe("/p11.jflap");
    expect(list).not.toContain("/p0.jflap");
    expect(list).not.toContain("/p1.jflap");
  });

  it("persists across instances sharing the same storage", () => {
    const storage = fakeStorage();
    new RecentProjects(storage).add("/shared.jflap");
    expect(new RecentProjects(storage).list()).toEqual(["/shared.jflap"]);
  });

  it("tolerates malformed stored content instead of throwing", () => {
    const storage = fakeStorage();
    storage.setItem("delta.recentProjects", "not json");
    const recent = new RecentProjects(storage);
    expect(recent.list()).toEqual([]);
  });
});
