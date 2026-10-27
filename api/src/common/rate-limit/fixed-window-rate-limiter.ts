/** Outcome of one hit against a fixed window. */
export interface RateLimitHit {
  allowed: boolean;
  /** Seconds until the window resets (≥ 1). */
  retryAfterSec: number;
}

interface Window {
  /** Epoch ms at which THIS entry's window ends (its own length, not a caller's). */
  expiresAt: number;
  count: number;
}

/** Default live-key cap for a limiter instance. */
export const DEFAULT_RATE_MAX_KEYS = 10_000;

/**
 * Per-key fixed-window counter (ROK-1833, extracted for ROK-1955). In-process,
 * like the global `ThrottlerGuard`'s default storage. `now` is swappable for
 * unit specs.
 *
 * Storage is bounded: the Map is kept in window-start order (a key whose
 * window restarts is moved to the back), so expiry and overflow eviction
 * pop from the front and stop at the first live entry — amortised O(1)
 * per insert, never a full scan. Past `maxKeys` the oldest key is dropped
 * (that key simply starts a fresh window).
 *
 * Each entry expires by its OWN stored `expiresAt`, so one instance can mix
 * window lengths: a 1-minute insert never evicts a live 10-minute counter
 * (Codex P2). A long-lived entry at the front may delay eviction of shorter
 * expired ones behind it; `maxKeys` still bounds the Map.
 *
 * In-flight reservations (`reserve` / `settle`) let an auth guard count
 * attempts whose DB lookup has not finished yet against the failure budget.
 */
export class FixedWindowRateLimiter {
  now: () => number = () => Date.now();
  /** Entries visited by the eviction sweep (spec-observable cost). */
  sweepSteps = 0;
  private readonly windows = new Map<string, Window>();
  private readonly inflight = new Map<string, number>();

  constructor(readonly maxKeys: number) {}

  /** Live keys currently stored. */
  get size(): number {
    return this.windows.size;
  }

  /** Count one hit for `key`; denied once `limit` hits land in `windowMs`. */
  hit(key: string, limit: number, windowMs: number): RateLimitHit {
    const now = this.now();
    const w = this.liveWindow(key, now, windowMs);
    const retryAfterSec = Math.max(1, Math.ceil((w.expiresAt - now) / 1000));
    if (w.count >= limit) return { allowed: false, retryAfterSec };
    w.count += 1;
    return { allowed: true, retryAfterSec };
  }

  /** True when `key` already has `limit` hits in its live window (no count). */
  isExhausted(key: string, limit: number): boolean {
    return this.countOf(key) >= limit;
  }

  /**
   * Reserve one in-flight attempt: false (nothing reserved) when counted
   * hits plus reservations already reach `limit`. Pair with `settle`.
   */
  reserve(key: string, limit: number): boolean {
    const pending = this.inflight.get(key) ?? 0;
    if (this.countOf(key) + pending >= limit) return false;
    this.inflight.set(key, pending + 1);
    return true;
  }

  /** Release a reservation; a failed attempt becomes a counted hit. */
  settle(key: string, failed: boolean, limit: number, windowMs: number): void {
    const pending = (this.inflight.get(key) ?? 1) - 1;
    if (pending > 0) this.inflight.set(key, pending);
    else this.inflight.delete(key);
    if (failed) this.hit(key, limit, windowMs);
  }

  /** Retry-After seconds for `key` (1 when it has no live window). */
  retryAfter(key: string): number {
    const w = this.windows.get(key);
    if (!w) return 1;
    return Math.max(1, Math.ceil((w.expiresAt - this.now()) / 1000));
  }

  private countOf(key: string): number {
    const w = this.windows.get(key);
    if (!w || this.now() >= w.expiresAt) return 0;
    return w.count;
  }

  /** The key's live window, starting (and appending) a fresh one if needed. */
  private liveWindow(key: string, now: number, windowMs: number): Window {
    const w = this.windows.get(key);
    if (w && now < w.expiresAt) return w;
    const fresh = { expiresAt: now + windowMs, count: 0 };
    this.windows.delete(key);
    this.windows.set(key, fresh);
    this.evict(now);
    return fresh;
  }

  /** Pop expired / overflow entries from the front; stop at the first keeper. */
  private evict(now: number): void {
    for (const [key, w] of this.windows) {
      this.sweepSteps += 1;
      const over = this.windows.size > this.maxKeys;
      if (!over && now < w.expiresAt) return;
      this.windows.delete(key);
    }
  }
}
