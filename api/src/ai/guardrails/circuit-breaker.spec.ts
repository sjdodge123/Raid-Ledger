import { ServiceUnavailableException } from '@nestjs/common';
import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker(3, 60_000);
  });

  it('starts in CLOSED state and allows requests', () => {
    expect(() => breaker.checkState()).not.toThrow();
  });

  it('trips to OPEN after threshold failures', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(() => breaker.checkState()).toThrow(ServiceUnavailableException);
  });

  it('stays CLOSED below threshold', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    expect(() => breaker.checkState()).not.toThrow();
  });

  it('resets to CLOSED on success', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    expect(() => breaker.checkState()).not.toThrow();
  });

  it('transitions to HALF_OPEN after cooldown', () => {
    jest.useFakeTimers();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(() => breaker.checkState()).toThrow();
    jest.advanceTimersByTime(61_000);
    // Should allow one probe request (HALF_OPEN)
    expect(() => breaker.checkState()).not.toThrow();
    jest.useRealTimers();
  });

  it('closes again after success in HALF_OPEN', () => {
    jest.useFakeTimers();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    jest.advanceTimersByTime(61_000);
    breaker.checkState(); // transitions to HALF_OPEN
    breaker.recordSuccess();
    expect(() => breaker.checkState()).not.toThrow();
    jest.useRealTimers();
  });
});
