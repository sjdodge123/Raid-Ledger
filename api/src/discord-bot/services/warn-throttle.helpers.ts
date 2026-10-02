/**
 * Pure warn-throttle helpers shared by hot-path loggers that keep a
 * module-local `Map<key, lastWarnedAtMs>`. Kept in its own module so specs can
 * spy on the prune across the import boundary (a same-module call is not
 * interceptable under ts-jest CJS).
 */

/**
 * Drop throttle entries whose TTL has lapsed (`nowMs - at >= ttlMs`) so a
 * hot-path warn Map stays bounded instead of accreting one key per event.
 */
export function pruneExpiredWarnings(
  map: Map<number, number>,
  nowMs: number,
  ttlMs: number,
): void {
  for (const [key, at] of map) {
    if (nowMs - at >= ttlMs) map.delete(key);
  }
}
