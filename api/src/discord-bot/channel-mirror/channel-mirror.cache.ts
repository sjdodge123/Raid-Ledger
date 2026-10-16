/**
 * ROK-1788 D5 — a TTL map with single-flight loads.
 *
 * `memorySwr` (common/swr-cache.ts) dedupes only its background refresh; a
 * cold miss there is one blocking fetch PER CALLER. Here concurrent misses on
 * one key share a single in-flight load. Whatever the loader RESOLVES with is
 * cached for the full TTL — the mirror resolves failures as states, so a broken
 * binding costs at most one Discord call per TTL. A loader that REJECTS is not
 * cached, and its in-flight slot is released.
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class ChannelMirrorCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly inflight = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** The cached value, the in-flight load, or a new load. */
  get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > this.now()) return Promise.resolve(hit.value);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const promise: Promise<T> = load()
      .then((value) => {
        if (this.inflight.get(key) === promise) this.store(key, value);
        return value;
      })
      .finally(() => {
        if (this.inflight.get(key) === promise) this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }

  /**
   * Forget a key (binding changed). A load already in flight still resolves
   * for its own callers but is NOT stored, so the next read fetches fresh.
   */
  clear(key: string): void {
    this.entries.delete(key);
    this.inflight.delete(key);
  }

  private store(key: string, value: T): void {
    const now = this.now();
    for (const [k, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(k);
    }
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
  }
}
