/**
 * Module-scoped dedup tracker for event-link unfurls — prevents duplicate
 * unfurls when dev-mode HMR creates multiple `EventLinkListener` instances
 * pointing at surviving Discord Client objects. Entries auto-expire after
 * 30 seconds via an `unref()`'d interval.
 *
 * Extracted from `event-link.listener.ts` (ROK-1245) so the listener stays
 * under the 300-line ESLint cap and so the integration suite can reset the
 * Map between spec files via `_resetRecentlyProcessed()`.
 */

const recentlyProcessed = new Map<string, number>();

const EXPIRY_MS = 30_000;

setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of recentlyProcessed) {
    if (now - ts > EXPIRY_MS) recentlyProcessed.delete(id);
  }
}, EXPIRY_MS).unref();

/** True when the given message id was processed within the expiry window. */
export function hasRecentlyProcessed(id: string): boolean {
  return recentlyProcessed.has(id);
}

/** Record that the given message id has just been processed. */
export function markRecentlyProcessed(id: string): void {
  recentlyProcessed.set(id, Date.now());
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
