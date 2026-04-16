import { RATE_LIMITS } from '../ai-chat.constants';

interface BucketEntry {
  timestamps: number[];
}

/**
 * Simple in-memory rate limiter for AI chat.
 * Tracks per-user (minute + hour) and global (daily) limits.
 */
export class AiChatRateLimiter {
  private readonly perUser = new Map<string, BucketEntry>();
  private globalCount = 0;
  private globalResetAt = this.nextDayReset();

  /** Check if a user is rate-limited. Returns true if blocked. */
  isLimited(userId: string): boolean {
    this.maybeResetGlobal();
    if (this.globalCount >= RATE_LIMITS.dailyCap) return true;
    const entry = this.getOrCreate(userId);
    const now = Date.now();
    this.pruneOld(entry, now);
    const lastMinute = this.countSince(entry, now - 60_000);
    if (lastMinute >= RATE_LIMITS.perMinute) return true;
    const lastHour = this.countSince(entry, now - 3_600_000);
    return lastHour >= RATE_LIMITS.perHour;
  }

  /** Record a usage event for a user. */
  record(userId: string): void {
    this.maybeResetGlobal();
    this.globalCount++;
    const entry = this.getOrCreate(userId);
    entry.timestamps.push(Date.now());
  }

  private getOrCreate(userId: string): BucketEntry {
    let entry = this.perUser.get(userId);
    if (!entry) {
      entry = { timestamps: [] };
      this.perUser.set(userId, entry);
    }
    return entry;
  }

  private pruneOld(entry: BucketEntry, now: number): void {
    const cutoff = now - 3_600_000;
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
  }

  private countSince(entry: BucketEntry, since: number): number {
    return entry.timestamps.filter((t) => t >= since).length;
  }

  private maybeResetGlobal(): void {
    if (Date.now() >= this.globalResetAt) {
      this.globalCount = 0;
      this.globalResetAt = this.nextDayReset();
    }
  }

  private nextDayReset(): number {
    const d = new Date();
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }
}
