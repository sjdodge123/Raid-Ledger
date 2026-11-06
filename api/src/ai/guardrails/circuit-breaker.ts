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
  /** When the current HALF_OPEN probe was admitted (tech-debt 3164). */
  private probeStartedAt = 0;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
    /** How long an unreported HALF_OPEN probe holds the slot; defaults to
     *  `cooldownMs`. Set it to the longest request timeout so a slow probe
     *  is not joined by a second one. */
    private readonly probeTimeoutMs: number = cooldownMs,
  ) {}

  /**
   * Check if a request is allowed through the breaker. After the cooldown,
   * exactly one probe is admitted; further requests are rejected until the
   * probe records a result. A probe that never reports (a later pre-check
   * threw) is replaced by a fresh one once `probeTimeoutMs` has passed.
   * @throws ServiceUnavailableException when the circuit is OPEN, or HALF_OPEN
   *   with a probe already in flight.
   */
  checkState(): void {
    if (this.state === 'CLOSED') return;
    const now = Date.now();
    const open = this.state === 'OPEN';
    const since = open ? this.openedAt : this.probeStartedAt;
    const wait = open ? this.cooldownMs : this.probeTimeoutMs;
    if (now - since >= wait) {
      this.state = 'HALF_OPEN';
      this.probeStartedAt = now;
      return;
    }
    throw new ServiceUnavailableException(
      'AI service is temporarily unavailable. Please try again later.',
    );
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
