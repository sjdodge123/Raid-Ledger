import { Injectable } from '@nestjs/common';

/** Outcome of one hit against a fixed one-minute window. */
export interface RateLimitHit {
  allowed: boolean;
  /** Seconds until the window resets (≥ 1). */
  retryAfterSec: number;
}

interface Window {
  startedAt: number;
  count: number;
}

/** Default live-key cap (`VALHEIM_LINK_RATE_MAX_KEYS`). */
export const DEFAULT_RATE_MAX_KEYS = 10_000;

function maxKeysFromEnv(): number {
  const raw = process.env.VALHEIM_LINK_RATE_MAX_KEYS;
  const n = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_RATE_MAX_KEYS;
}

/**
 * Per-key fixed-window counter (ROK-1833). In-process, like the global
 * `ThrottlerGuard`'s default storage. `now` is swappable for unit specs.
 *
 * Storage is bounded: the Map is kept in window-start order (a key whose
 * window restarts is moved to the back), so expiry and overflow eviction
 * pop from the front and stop at the first live entry — amortised O(1)
 * per insert, never a full scan. Past `maxKeys` the oldest key is dropped
 * (that IP/server simply starts a fresh window).
 *
 * In-flight reservations (`reserve` / `settle`) let the auth guard count
 * attempts whose DB lookup has not finished yet against the failure budget.
 */
@Injectable()
export class ValheimLinkRateLimiter {
  now: () => number = () => Date.now();
  readonly maxKeys: number = maxKeysFromEnv();
  /** Entries visited by the eviction sweep (spec-observable cost). */
  sweepSteps = 0;
  private readonly windows = new Map<string, Window>();
  private readonly inflight = new Map<string, number>();

  /** Live keys currently stored. */
  get size(): number {
    return this.windows.size;
  }

  /** Count one hit for `key`; denied once `limit` hits land in `windowMs`. */
  hit(key: string, limit: number, windowMs: number): RateLimitHit {
    const now = this.now();
    const w = this.liveWindow(key, now, windowMs);
    const retryAfterSec = Math.max(
      1,
      Math.ceil((w.startedAt + windowMs - now) / 1000),
    );
    if (w.count >= limit) return { allowed: false, retryAfterSec };
    w.count += 1;
    return { allowed: true, retryAfterSec };
  }

  /** True when `key` already has `limit` hits in its live window (no count). */
  isExhausted(key: string, limit: number, windowMs: number): boolean {
    return this.countOf(key, windowMs) >= limit;
  }

  /**
   * Reserve one in-flight attempt: false (nothing reserved) when counted
   * hits plus reservations already reach `limit`. Pair with `settle`.
   */
  reserve(key: string, limit: number, windowMs: number): boolean {
    const pending = this.inflight.get(key) ?? 0;
    if (this.countOf(key, windowMs) + pending >= limit) return false;
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
  retryAfter(key: string, windowMs: number): number {
    const w = this.windows.get(key);
    if (!w) return 1;
    return Math.max(1, Math.ceil((w.startedAt + windowMs - this.now()) / 1000));
  }

  private countOf(key: string, windowMs: number): number {
    const w = this.windows.get(key);
    if (!w || this.now() - w.startedAt >= windowMs) return 0;
    return w.count;
  }

  /** The key's live window, starting (and appending) a fresh one if needed. */
  private liveWindow(key: string, now: number, windowMs: number): Window {
    const w = this.windows.get(key);
    if (w && now - w.startedAt < windowMs) return w;
    const fresh = { startedAt: now, count: 0 };
    this.windows.delete(key);
    this.windows.set(key, fresh);
    this.evict(now, windowMs);
    return fresh;
  }

  /** Pop expired / overflow entries from the front; stop at the first keeper. */
  private evict(now: number, windowMs: number): void {
    for (const [key, w] of this.windows) {
      this.sweepSteps += 1;
      const over = this.windows.size > this.maxKeys;
      if (!over && now - w.startedAt < windowMs) return;
      this.windows.delete(key);
    }
  }
}
