import { HttpException } from '@nestjs/common';
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
