import { HttpException, HttpStatus } from '@nestjs/common';
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

// — Adversarial tests —

describe('ConcurrencyLimiter (adversarial)', () => {
  it('throws with HTTP 429 status', () => {
    const limiter = new ConcurrencyLimiter(1);
    limiter.acquire();
    try {
      limiter.acquire();
      fail('expected HttpException');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });

  it('blocks exactly at max (boundary: maxConcurrent)', () => {
    const limiter = new ConcurrencyLimiter(3);
    limiter.acquire(); // slot 1
    limiter.acquire(); // slot 2
    limiter.acquire(); // slot 3 — at max, not yet over
    expect(() => limiter.acquire()).toThrow(HttpException); // slot 4 — over
  });

  it('release below zero does not go negative', () => {
    const limiter = new ConcurrencyLimiter(2);
    // release without acquire — should not error or go below 0
    expect(() => limiter.release()).not.toThrow();
    // After spurious release, a full cycle should still work
    limiter.acquire();
    limiter.acquire();
    expect(() => limiter.acquire()).toThrow(HttpException);
  });

  it('withLimit propagates non-Error rejection unchanged', async () => {
    const limiter = new ConcurrencyLimiter(2);
    await expect(
      limiter.withLimit(() => Promise.reject('string error')),
    ).rejects.toBe('string error');
  });

  it('withLimit releases slot even when fn throws synchronously', async () => {
    const limiter = new ConcurrencyLimiter(1);
    await expect(
      limiter.withLimit(() => { throw new Error('sync throw'); }),
    ).rejects.toThrow('sync throw');
    // Slot should be free
    expect(() => limiter.acquire()).not.toThrow();
  });

  it('maxConcurrent=1 serializes: only one slot at a time', async () => {
    const limiter = new ConcurrencyLimiter(1);
    let inFlight = 0;
    let maxObserved = 0;
    const tasks = Array.from({ length: 3 }, (_, i) =>
      limiter.withLimit(async () => {
        inFlight++;
        maxObserved = Math.max(maxObserved, inFlight);
        await Promise.resolve(); // yield
        inFlight--;
        return i;
      }).catch(() => null),
    );
    await Promise.all(tasks);
    // Because acquire throws on the 2nd and 3rd tasks (not queued), maxObserved is 1
    expect(maxObserved).toBe(1);
  });

  it('withLimit returns the resolved value from fn', async () => {
    const limiter = new ConcurrencyLimiter(2);
    const result = await limiter.withLimit(() => Promise.resolve(42));
    expect(result).toBe(42);
  });
});
