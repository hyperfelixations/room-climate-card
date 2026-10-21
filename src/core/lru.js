// A least-recently-used cache for pure results keyed by strings. Module-level memos are
// shared by every card on a dashboard, so each holds several answers, not the last one.
// A stored value is never undefined; `get()` answers a miss with undefined.

export function createLruCache(capacity = 16) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError(`LRU capacity must be a positive integer, got ${capacity}`);
  // A Map iterates in insertion order, so re-inserting on use keeps the oldest entry first.
  const entries = new Map();
  return {
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      if (entries.size > capacity) entries.delete(entries.keys().next().value);
    },
  };
}
