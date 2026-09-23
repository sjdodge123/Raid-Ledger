/**
 * Short-lived reuse of Discord server invites (ROK-1631).
 *
 * Minting a guild invite is a real, persistent Discord object, so a caller
 * that asks repeatedly should get the link it already has rather than a new
 * one each time. Invites stay single-use; only the lookup is shared.
 */

/** How long one (user, event) invite is handed back — well inside its 24h life. */
export const SERVER_INVITE_REUSE_MS = 60 * 60 * 1000;

/** Hard ceiling on remembered invites so the map cannot grow without bound. */
export const SERVER_INVITE_CACHE_MAX = 500;

interface CacheEntry {
  /** Clock reading when the mint was started. */
  readonly at: number;
  /** The in-flight or settled lookup, shared by every caller in the window. */
  readonly result: Promise<string | null>;
}

/**
 * An in-memory, per-process cache of server-invite lookups keyed by
 * `user:event`. Pure — it performs no I/O and owns no Nest lifecycle.
 */
export class ServerInviteCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Return the pending or finished lookup for this user and event, or start
   * `mint` and remember it for `SERVER_INVITE_REUSE_MS`.
   *
   * A mint that yields `null` or rejects is forgotten, so the next caller
   * retries; a rejection still propagates to the caller that triggered it.
   */
  getOrMint(
    userId: number,
    eventId: number,
    mint: () => Promise<string | null>,
  ): Promise<string | null> {
    const key = `${userId}:${eventId}`;
    const existing = this.entries.get(key);
    if (existing && this.now() - existing.at < SERVER_INVITE_REUSE_MS) {
      return existing.result;
    }
    this.makeRoom();
    const result = mint().then(
      (url) => {
        if (url === null) this.forget(key, result);
        return url;
      },
      (error) => {
        this.forget(key, result);
        throw error;
      },
    );
    this.entries.set(key, { at: this.now(), result });
    return result;
  }

  /** Drop a remembered lookup, unless a newer one has already replaced it. */
  private forget(key: string, result: Promise<string | null>): void {
    if (this.entries.get(key)?.result === result) this.entries.delete(key);
  }

  /** Evict aged-out entries, then the oldest, until one slot is free. */
  private makeRoom(): void {
    const cutoff = this.now() - SERVER_INVITE_REUSE_MS;
    for (const [key, entry] of this.entries) {
      if (entry.at <= cutoff) this.entries.delete(key);
    }
    while (this.entries.size >= SERVER_INVITE_CACHE_MAX) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}
