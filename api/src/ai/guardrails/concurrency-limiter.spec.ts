import { HttpException } from '@nestjs/common';
import { ConcurrencyLimiter } from './concurrency-limiter';

describe('ConcurrencyLimiter', () => {
  let limiter: ConcurrencyLimiter;

  beforeEach(() => {
    limiter = new ConcurrencyLimiter(2);
  });

  it('allows requests under the limit', () => {
    expect(() => limiter.acquire()).not.toThrow();
    expect(() => limiter.acquire()).not.toThrow();
  });

  it('throws when concurrency limit exceeded', () => {
    limiter.acquire();
    limiter.acquire();
    expect(() => limiter.acquire()).toThrow(HttpException);
  });

  it('allows new requests after release', () => {
    limiter.acquire();
    limiter.acquire();
    limiter.release();
    expect(() => limiter.acquire()).not.toThrow();
  });

  it('withLimit auto-releases on success', async () => {
    const result = await limiter.withLimit(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
    // Both slots should be free again
    limiter.acquire();
    limiter.acquire();
    expect(() => limiter.acquire()).toThrow();
  });

  it('withLimit auto-releases on error', async () => {
    await expect(
      limiter.withLimit(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    // Slot should be free
    expect(() => limiter.acquire()).not.toThrow();
  });
});
