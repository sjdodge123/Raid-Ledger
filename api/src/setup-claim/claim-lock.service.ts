/**
 * ROK-1701 D-11: the global soft lock on claim attempts. 100 wrong codes in a
 * rolling 60-min window ⇒ claiming pauses for 15 min. The code itself is
 * never burned. In-memory by design (cloud is single-instance); a restart
 * clears it. Only a wrong code counts — never 400/403/409/410.
 */
import { Injectable } from '@nestjs/common';

export const CLAIM_LOCK_THRESHOLD = 100;
export const CLAIM_LOCK_WINDOW_MS = 60 * 60 * 1000;
export const CLAIM_LOCK_DURATION_MS = 15 * 60 * 1000;

@Injectable()
export class ClaimLockService {
  private failures: number[] = [];
  private lockedUntilMs: number | null = null;

  /** When the active lock lapses, or null when claiming is open. */
  lockedUntil(): Date | null {
    this.expire(Date.now());
    return this.lockedUntilMs === null ? null : new Date(this.lockedUntilMs);
  }

  /** Count one wrong code. Returns the lock end if this (or an earlier)
   *  failure locked claiming, else null. */
  recordFailure(): Date | null {
    const now = Date.now();
    this.expire(now);
    if (this.lockedUntilMs !== null) return new Date(this.lockedUntilMs);
    this.failures.push(now);
    if (this.failures.length < CLAIM_LOCK_THRESHOLD) return null;
    this.lockedUntilMs = now + CLAIM_LOCK_DURATION_MS;
    return new Date(this.lockedUntilMs);
  }

  /** DEMO_MODE fixture: lock now without 100 requests. */
  forceLock(): Date {
    this.lockedUntilMs = Date.now() + CLAIM_LOCK_DURATION_MS;
    return new Date(this.lockedUntilMs);
  }

  /** DEMO_MODE fixture / re-arm: forget every failure and any lock. */
  reset(): void {
    this.failures = [];
    this.lockedUntilMs = null;
  }

  /** Lapse the lock (clearing the window) and drop out-of-window failures. */
  private expire(now: number): void {
    if (this.lockedUntilMs !== null && now >= this.lockedUntilMs) {
      this.reset();
      return;
    }
    const cutoff = now - CLAIM_LOCK_WINDOW_MS;
    this.failures = this.failures.filter((at) => at > cutoff);
  }
}
