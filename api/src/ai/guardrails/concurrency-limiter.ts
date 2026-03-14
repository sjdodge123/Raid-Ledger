import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Limits the number of concurrent in-flight LLM requests.
 * Plain class — not a NestJS injectable.
 */
export class ConcurrencyLimiter {
  private inFlight = 0;

  constructor(private readonly maxConcurrent: number) {}

  /**
   * Acquire a concurrency slot.
   * @throws TooManyRequestsException if all slots are occupied.
   */
  acquire(): void {
    if (this.inFlight >= this.maxConcurrent) {
      throw new HttpException(
        'AI service is busy. Please try again shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.inFlight++;
  }

  /** Release a concurrency slot. */
  release(): void {
    if (this.inFlight > 0) this.inFlight--;
  }

  /**
   * Execute a function with automatic acquire/release.
   * Guarantees the slot is released even on error.
   */
  async withLimit<T>(fn: () => Promise<T>): Promise<T> {
    this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
