/**
 * Bounded in-memory cache helpers for GameTimeService (backlog 2818).
 *
 * The composite-view cache is keyed on caller-supplied `week` values, so an
 * unbounded Map lets any member grow the API heap by walking distinct weeks.
 * Expired entries are otherwise evicted only when the same key is read again.
 */

/** Max entries kept in the game-time cache before eviction kicks in. */
export const GAME_TIME_CACHE_MAX_ENTRIES = 2000;

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

/**
 * Store `entry` under `key`, then keep `cache` at or under `maxEntries`:
 * first drop every expired entry, then the oldest-inserted ones (Map order).
 */
export function setBoundedCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  entry: CacheEntry<T>,
  now: number,
  maxEntries = GAME_TIME_CACHE_MAX_ENTRIES,
): void {
  // Re-inserting moves an existing key to the newest position.
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size <= maxEntries) return;
  for (const [k, v] of cache) {
    if (v.expiresAt < now) cache.delete(k);
  }
  for (const k of cache.keys()) {
    if (cache.size <= maxEntries) break;
    cache.delete(k);
  }
}
