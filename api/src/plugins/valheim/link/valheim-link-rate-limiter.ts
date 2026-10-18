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

/**
 * Per-key fixed-window counter (ROK-1833). In-process, like the global
 * `ThrottlerGuard`'s default storage. `now` is swappable for unit specs.
 */
@Injectable()
export class ValheimLinkRateLimiter {
  now: () => number = () => Date.now();
  private readonly windows = new Map<string, Window>();

  /** Count one hit for `key`; denied once `limit` hits land in `windowMs`. */
  hit(key: string, limit: number, windowMs: number): RateLimitHit {
    const now = this.now();
    let w = this.windows.get(key);
    if (!w || now - w.startedAt >= windowMs) {
      w = { startedAt: now, count: 0 };
      this.windows.set(key, w);
      this.prune(now, windowMs);
    }
    const retryAfterSec = Math.max(
      1,
      Math.ceil((w.startedAt + windowMs - now) / 1000),
    );
    if (w.count >= limit) return { allowed: false, retryAfterSec };
    w.count += 1;
    return { allowed: true, retryAfterSec };
  }

  private prune(now: number, windowMs: number): void {
    for (const [key, w] of this.windows) {
      if (now - w.startedAt >= windowMs) this.windows.delete(key);
    }
  }
}
