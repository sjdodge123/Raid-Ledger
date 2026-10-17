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

// — Adversarial tests —

describe('CircuitBreaker (adversarial)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('trips at exactly the threshold (boundary condition)', () => {
    const breaker = new CircuitBreaker(3, 60_000);
    // 2 failures — should NOT trip
    breaker.recordFailure();
    breaker.recordFailure();
    expect(() => breaker.checkState()).not.toThrow();
    // 3rd failure — should trip
    breaker.recordFailure();
    expect(() => breaker.checkState()).toThrow(ServiceUnavailableException);
  });

  it('remains OPEN just before cooldown expires', () => {
    jest.useFakeTimers();
    const breaker = new CircuitBreaker(3, 60_000);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    jest.advanceTimersByTime(59_999); // 1ms before cooldown
    expect(() => breaker.checkState()).toThrow(ServiceUnavailableException);
  });

  it('transitions to HALF_OPEN at exactly the cooldown boundary', () => {
    jest.useFakeTimers();
    const breaker = new CircuitBreaker(3, 60_000);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    jest.advanceTimersByTime(60_000); // exactly at cooldown
    expect(() => breaker.checkState()).not.toThrow();
  });

  it('re-opens if the HALF_OPEN probe fails', () => {
    jest.useFakeTimers();
    const breaker = new CircuitBreaker(3, 60_000);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    jest.advanceTimersByTime(61_000);
    breaker.checkState(); // HALF_OPEN
    breaker.recordFailure(); // probe fails — should re-open
    expect(() => breaker.checkState()).toThrow(ServiceUnavailableException);
  });

  it('resets failure count on success so threshold restarts from zero', () => {
    const breaker = new CircuitBreaker(3, 60_000);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess(); // resets count
    // Now need 3 fresh failures to trip again
    breaker.recordFailure();
    breaker.recordFailure();
    expect(() => breaker.checkState()).not.toThrow();
    breaker.recordFailure();
    expect(() => breaker.checkState()).toThrow(ServiceUnavailableException);
  });

  it('throws ServiceUnavailableException with expected message', () => {
    const breaker = new CircuitBreaker(1, 60_000);
    breaker.recordFailure();
    expect(() => breaker.checkState()).toThrow(
      'AI service is temporarily unavailable',
    );
  });

  it('threshold of 1 trips on the first failure', () => {
    const breaker = new CircuitBreaker(1, 60_000);
    breaker.recordFailure();
    expect(() => breaker.checkState()).toThrow(ServiceUnavailableException);
  });

  it('recordSuccess while already CLOSED has no adverse effect', () => {
    const breaker = new CircuitBreaker(3, 60_000);
    breaker.recordSuccess(); // called while CLOSED
    expect(() => breaker.checkState()).not.toThrow();
  });

  it('cooldown starts from when the circuit opened, not from subsequent calls', () => {
    jest.useFakeTimers();
    const breaker = new CircuitBreaker(3, 60_000);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure(); // opens now (t=0)
    jest.advanceTimersByTime(30_000); // still open at t=30s
    expect(() => breaker.checkState()).toThrow();
    jest.advanceTimersByTime(30_001); // now t=60_001ms — cooldown elapsed
    expect(() => breaker.checkState()).not.toThrow();
  });
});
