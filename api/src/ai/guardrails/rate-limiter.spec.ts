import { HttpException, HttpStatus } from '@nestjs/common';
import { LlmRateLimiter } from './rate-limiter';

describe('LlmRateLimiter', () => {
  let limiter: LlmRateLimiter;

  beforeEach(() => {
    limiter = new LlmRateLimiter();
  });

  it('allows requests under the limit', () => {
    expect(() => limiter.checkRateLimit(1, 5)).not.toThrow();
    expect(() => limiter.checkRateLimit(1, 5)).not.toThrow();
  });

  it('throws TooManyRequestsException when limit exceeded', () => {
    for (let i = 0; i < 3; i++) {
      limiter.checkRateLimit(1, 3);
    }
    expect(() => limiter.checkRateLimit(1, 3)).toThrow(HttpException);
  });

  it('tracks users independently', () => {
    for (let i = 0; i < 3; i++) {
      limiter.checkRateLimit(1, 3);
    }
    expect(() => limiter.checkRateLimit(2, 3)).not.toThrow();
  });

  it('resets after the window expires', () => {
    jest.useFakeTimers();
    for (let i = 0; i < 3; i++) {
      limiter.checkRateLimit(1, 3);
    }
    expect(() => limiter.checkRateLimit(1, 3)).toThrow();
    jest.advanceTimersByTime(61_000);
    expect(() => limiter.checkRateLimit(1, 3)).not.toThrow();
    jest.useRealTimers();
  });
});

// — Adversarial tests —

describe('LlmRateLimiter (adversarial)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('throws with HTTP 429 status', () => {
    const limiter = new LlmRateLimiter();
    limiter.checkRateLimit(1, 1);
    try {
      limiter.checkRateLimit(1, 1);
      fail('expected HttpException');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  });

  it('throws at exactly the limit (boundary: call maxPerMinute+1)', () => {
    const limiter = new LlmRateLimiter();
    // maxPerMinute=2: first two calls succeed, third throws
    limiter.checkRateLimit(1, 2);
    limiter.checkRateLimit(1, 2);
    expect(() => limiter.checkRateLimit(1, 2)).toThrow(HttpException);
  });

  it('does not throw at exactly the limit (last allowed call)', () => {
    const limiter = new LlmRateLimiter();
    // maxPerMinute=3: call 3 times — all should succeed
    expect(() => {
      limiter.checkRateLimit(1, 3);
      limiter.checkRateLimit(1, 3);
      limiter.checkRateLimit(1, 3);
    }).not.toThrow();
  });

  it('window expiry resets count to 1 (first call in new window)', () => {
    jest.useFakeTimers();
    const limiter = new LlmRateLimiter();
    limiter.checkRateLimit(1, 2);
    limiter.checkRateLimit(1, 2);
    jest.advanceTimersByTime(60_001);
    // First call in new window — should succeed (count resets to 1)
    expect(() => limiter.checkRateLimit(1, 2)).not.toThrow();
    // Second call — should still succeed (count = 2)
    expect(() => limiter.checkRateLimit(1, 2)).not.toThrow();
    // Third call — should throw (over limit)
    expect(() => limiter.checkRateLimit(1, 2)).toThrow(HttpException);
  });

  it('does not throttle new user when another user is at limit', () => {
    const limiter = new LlmRateLimiter();
    limiter.checkRateLimit(10, 1);
    // User 10 is now at limit — user 20 should be unaffected
    expect(() => limiter.checkRateLimit(20, 1)).not.toThrow();
  });

  it('many distinct users can each make up to the limit without interfering', () => {
    const limiter = new LlmRateLimiter();
    for (let userId = 1; userId <= 50; userId++) {
      expect(() => limiter.checkRateLimit(userId, 5)).not.toThrow();
    }
  });

  it('window does not reset before expiry', () => {
    jest.useFakeTimers();
    const limiter = new LlmRateLimiter();
    limiter.checkRateLimit(1, 1);
    jest.advanceTimersByTime(59_999); // 1ms before window expires
    expect(() => limiter.checkRateLimit(1, 1)).toThrow(HttpException);
  });
});
