import { FixedWindowRateLimiter } from './fixed-window-rate-limiter';

const make = (maxKeys = 10_000): FixedWindowRateLimiter =>
  new FixedWindowRateLimiter(maxKeys);

describe('FixedWindowRateLimiter (ROK-1955, extracted from ROK-1833)', () => {
  it('allows `limit` hits per window, then denies with Retry-After, then resets', () => {
    const limiter = make();
    let now = 1_000_000;
    limiter.now = () => now;
    for (let i = 0; i < 3; i++)
      expect(limiter.hit('k', 3, 60_000).allowed).toBe(true);
    now += 15_000;
    expect(limiter.hit('k', 3, 60_000)).toEqual({
      allowed: false,
      retryAfterSec: 45,
    });
    expect(limiter.retryAfter('k')).toBe(45);
    now += 45_000;
    expect(limiter.hit('k', 3, 60_000).allowed).toBe(true);
  });

  it('keys are independent; retryAfter is 1 for an unknown key', () => {
    const limiter = make();
    limiter.now = () => 0;
    expect(limiter.hit('a', 1, 60_000).allowed).toBe(true);
    expect(limiter.hit('a', 1, 60_000).allowed).toBe(false);
    expect(limiter.hit('b', 1, 60_000).allowed).toBe(true);
    expect(limiter.retryAfter('zzz')).toBe(1);
  });

  it('keeps maxKeys as passed in', () => {
    expect(make(7).maxKeys).toBe(7);
  });
});

describe('FixedWindowRateLimiter — bounded storage and reservations', () => {
  it('distinct keys insert with a linear sweep cost', () => {
    const limiter = make();
    limiter.now = () => 1_000;
    for (let i = 0; i < 10_000; i += 1) limiter.hit(`k${i}`, 5, 60_000);
    expect(limiter.size).toBe(10_000);
    expect(limiter.sweepSteps).toBe(10_000);
  });

  it('past maxKeys the oldest key is evicted', () => {
    const limiter = make(100);
    limiter.now = () => 1_000;
    for (let i = 0; i < 1_000; i += 1) limiter.hit(`k${i}`, 1, 60_000);
    expect(limiter.size).toBe(100);
    expect(limiter.sweepSteps).toBeLessThanOrEqual(2 * 1_000);
    expect(limiter.isExhausted('k0', 1)).toBe(false);
    expect(limiter.isExhausted('k999', 1)).toBe(true);
  });

  it('expired windows are dropped from the front on the next insert', () => {
    let t = 0;
    const limiter = make();
    limiter.now = () => t;
    for (let i = 0; i < 50; i += 1) limiter.hit(`old${i}`, 5, 60_000);
    t = 60_000;
    limiter.hit('new', 5, 60_000);
    expect(limiter.size).toBe(1);
  });

  it('reserve counts in-flight attempts; a failed settle becomes a hit', () => {
    const limiter = make();
    expect(limiter.reserve('ip', 2)).toBe(true);
    expect(limiter.reserve('ip', 2)).toBe(true);
    expect(limiter.reserve('ip', 2)).toBe(false);
    limiter.settle('ip', false, 2, 60_000);
    limiter.settle('ip', true, 2, 60_000);
    expect(limiter.reserve('ip', 2)).toBe(true);
    expect(limiter.reserve('ip', 2)).toBe(false);
  });

  it('a short-window insert never evicts a longer, still-live window (Codex P2)', () => {
    let t = 0;
    const limiter = make();
    limiter.now = () => t;
    for (let i = 0; i < 10; i += 1) limiter.hit('code:user1', 10, 600_000);
    expect(limiter.isExhausted('code:user1', 10)).toBe(true);
    t = 60_000;
    limiter.hit('start:ip', 5, 60_000);
    expect(limiter.isExhausted('code:user1', 10)).toBe(true);
    expect(limiter.hit('code:user1', 10, 600_000).allowed).toBe(false);
  });
});
