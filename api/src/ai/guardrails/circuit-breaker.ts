import { ServiceUnavailableException } from '@nestjs/common';

/** Circuit breaker states. */
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Circuit breaker for LLM provider calls.
 * Trips after a threshold of consecutive failures, then cools down
 * before allowing a single probe request.
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private openedAt = 0;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
  ) {}

  /**
   * Check if a request is allowed through the breaker.
   * @throws ServiceUnavailableException when the circuit is OPEN.
   */
  checkState(): void {
    if (this.state === 'CLOSED') return;

    if (this.state === 'OPEN') {
      if (Date.now() - this.openedAt >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
        return;
      }
      throw new ServiceUnavailableException(
        'AI service is temporarily unavailable. Please try again later.',
      );
    }
    // HALF_OPEN — allow one probe request
  }

  /** Record a successful request — resets the breaker to CLOSED. */
  recordSuccess(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  /** Record a failed request — may trip the breaker to OPEN. */
  recordFailure(): void {
    this.failureCount++;
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
      this.openedAt = Date.now();
    }
  }
}
