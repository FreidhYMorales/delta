// Recently-opened project files (design D13) — a pure frontend list, no
// backend/IPC dependency at all: just the file paths the user has opened or
// saved a project to, most-recent-first, capped at 10. Backed by an
// INJECTABLE storage object (`getItem`/`setItem`, the same duck-typed shape
// `window.localStorage` already exposes) rather than hardcoding
// `window.localStorage`, so tests can inject a fake in-memory storage
// instead of depending on a real browser API.

const STORAGE_KEY = "delta.recentProjects";
const MAX_ENTRIES = 10;

export class RecentProjects {
  /** @param {{getItem: (key: string) => string|null, setItem: (key: string, value: string) => void}} storage */
  constructor(storage) {
    this.storage = storage;
  }

  /** @returns {string[]} most-recently-opened first, at most `MAX_ENTRIES` long. */
  list() {
    return readList(this.storage);
  }

  /** Adds `path` to the front of the list. Re-adding a path already present
   * moves it to the front instead of duplicating it (design D13). Drops the
   * oldest entry once the list would exceed `MAX_ENTRIES`.
   * @param {string} path
   */
  add(path) {
    const withoutPath = readList(this.storage).filter((p) => p !== path);
    const next = [path, ...withoutPath].slice(0, MAX_ENTRIES);
    writeList(this.storage, next);
  }
}

function readList(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeList(storage, list) {
  storage.setItem(STORAGE_KEY, JSON.stringify(list));
}
