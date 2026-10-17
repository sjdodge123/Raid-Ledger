/**
 * Module-scoped dedup tracker for event-link unfurls — prevents duplicate
 * unfurls when dev-mode HMR creates multiple `EventLinkListener` instances
 * pointing at surviving Discord Client objects. Entries expire 30 seconds
 * after they are recorded.
 *
 * Expiry is LAZY — there is deliberately no sweeper timer (ROK-1527). A
 * module-scope `setInterval` is re-created every time the module is
 * evaluated (Jest re-evaluates it once per spec file), and each live
 * interval's closure pins the realm that created it, so the integration
 * suite retained every finished spec file's whole context. Instead:
 * - `hasRecentlyProcessed` treats an entry older than EXPIRY_MS as absent
 *   and deletes it on the spot;
 * - `markRecentlyProcessed` prunes expired entries once the map grows past
 *   PRUNE_THRESHOLD. The map holds one entry per unfurled message in the
 *   last 30 s (a handful in practice), so the threshold keeps the common
 *   write O(1) while still bounding memory under a burst.
 *
 * Extracted from `event-link.listener.ts` (ROK-1245) so the listener stays
 * under the 300-line ESLint cap and so the integration suite can reset the
 * Map between spec files via `_resetRecentlyProcessed()`.
 */

const recentlyProcessed = new Map<string, number>();

/** How long a processed message id suppresses a repeat unfurl. */
export const EXPIRY_MS = 30_000;

/** Map size above which a write sweeps expired entries. */
export const PRUNE_THRESHOLD = 100;

function isExpired(ts: number, now: number): boolean {
  return now - ts > EXPIRY_MS;
}

function pruneExpired(now: number): void {
  for (const [id, ts] of recentlyProcessed) {
    if (isExpired(ts, now)) recentlyProcessed.delete(id);
  }
}

/** True when the given message id was processed within the expiry window. */
export function hasRecentlyProcessed(id: string): boolean {
  const ts = recentlyProcessed.get(id);
  if (ts === undefined) return false;
  if (isExpired(ts, Date.now())) {
    recentlyProcessed.delete(id);
    return false;
  }
  return true;
}

/** Record that the given message id has just been processed. */
export function markRecentlyProcessed(id: string): void {
  const now = Date.now();
  if (recentlyProcessed.size >= PRUNE_THRESHOLD) pruneExpired(now);
  recentlyProcessed.set(id, now);
}

/** @internal Exposed for testing only — clears the dedup map. */
export function _resetRecentlyProcessed(): void {
  recentlyProcessed.clear();
}

/** @internal Exposed for testing only — record an entry directly. */
export function _setRecentlyProcessed(id: string, ts: number): void {
  recentlyProcessed.set(id, ts);
}

/** @internal Exposed for testing only — current dedup map size. */
export function _recentlyProcessedSize(): number {
  return recentlyProcessed.size;
}
