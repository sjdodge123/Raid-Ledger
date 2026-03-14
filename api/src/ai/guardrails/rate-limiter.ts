import { HttpException, HttpStatus } from '@nestjs/common';

interface RateBucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;

/**
 * In-memory per-user rate limiter for LLM requests.
 * Plain class — not a NestJS injectable.
 */
export class LlmRateLimiter {
  private buckets = new Map<number, RateBucket>();

  /**
   * Check if a user has exceeded their rate limit.
   * Increments the counter on success.
   * @throws TooManyRequestsException if the limit is exceeded.
   */
  checkRateLimit(userId: number, maxPerMinute: number): void {
    this.cleanupExpired();
    const now = Date.now();
    const bucket = this.buckets.get(userId);

    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(userId, { count: 1, resetAt: now + WINDOW_MS });
      return;
    }

    if (bucket.count >= maxPerMinute) {
      throw new HttpException(
        'AI rate limit exceeded. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    bucket.count++;
  }

  /** Remove expired entries to prevent memory leaks. */
  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) {
        this.buckets.delete(key);
      }
    }
  }
}
