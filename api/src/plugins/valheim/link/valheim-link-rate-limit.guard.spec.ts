import { HttpException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ValheimLinkRateLimiter } from './valheim-link-rate-limiter';
import {
  bucketLimit,
  ValheimLinkRateLimitGuard,
  type ValheimLinkBucket,
} from './valheim-link-rate-limit.guard';

const ENV_KEYS = [
  'VALHEIM_LINK_RATE_MESSAGES_PER_MIN',
  'VALHEIM_LINK_RATE_BLOBS_PER_MIN',
  'THROTTLE_DISABLED',
] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('ValheimLinkRateLimiter (ROK-1833)', () => {
  it('allows `limit` hits per window, then denies with Retry-After, then resets', () => {
    const limiter = new ValheimLinkRateLimiter();
    let now = 1_000_000;
    limiter.now = () => now;
    for (let i = 0; i < 3; i++)
      expect(limiter.hit('k', 3, 60_000).allowed).toBe(true);
    now += 15_000;
    expect(limiter.hit('k', 3, 60_000)).toEqual({
      allowed: false,
      retryAfterSec: 45,
    });
    now += 45_000;
    expect(limiter.hit('k', 3, 60_000).allowed).toBe(true);
  });

  it('keys are independent', () => {
    const limiter = new ValheimLinkRateLimiter();
    limiter.now = () => 0;
    expect(limiter.hit('a', 1, 60_000).allowed).toBe(true);
    expect(limiter.hit('a', 1, 60_000).allowed).toBe(false);
    expect(limiter.hit('b', 1, 60_000).allowed).toBe(true);
  });
});

describe('ValheimLinkRateLimiter — bounded storage (ROK-1833)', () => {
  afterEach(() => {
    delete process.env.VALHEIM_LINK_RATE_MAX_KEYS;
  });

  it('10,000 distinct keys insert with a linear sweep cost', () => {
    const limiter = new ValheimLinkRateLimiter();
    limiter.now = () => 1_000;
    for (let i = 0; i < 10_000; i += 1) limiter.hit(`k${i}`, 5, 60_000);
    expect(limiter.size).toBe(10_000);
    // One stop-check per insert, nothing else: never a full-map scan.
    expect(limiter.sweepSteps).toBe(10_000);
  });

  it('past VALHEIM_LINK_RATE_MAX_KEYS the oldest key is evicted', () => {
    process.env.VALHEIM_LINK_RATE_MAX_KEYS = '100';
    const limiter = new ValheimLinkRateLimiter();
    limiter.now = () => 1_000;
    for (let i = 0; i < 1_000; i += 1) limiter.hit(`k${i}`, 1, 60_000);
    expect(limiter.size).toBe(100);
    expect(limiter.sweepSteps).toBeLessThanOrEqual(2 * 1_000);
    expect(limiter.isExhausted('k0', 1, 60_000)).toBe(false);
    expect(limiter.isExhausted('k999', 1, 60_000)).toBe(true);
  });

  it('expired windows are dropped from the front on the next insert', () => {
    let t = 0;
    const limiter = new ValheimLinkRateLimiter();
    limiter.now = () => t;
    for (let i = 0; i < 50; i += 1) limiter.hit(`old${i}`, 5, 60_000);
    t = 60_000;
    limiter.hit('new', 5, 60_000);
    expect(limiter.size).toBe(1);
  });

  it('reserve counts in-flight attempts; a failed settle becomes a hit', () => {
    const limiter = new ValheimLinkRateLimiter();
    expect(limiter.reserve('ip', 2, 60_000)).toBe(true);
    expect(limiter.reserve('ip', 2, 60_000)).toBe(true);
    expect(limiter.reserve('ip', 2, 60_000)).toBe(false);
    limiter.settle('ip', false, 2, 60_000);
    limiter.settle('ip', true, 2, 60_000);
    expect(limiter.reserve('ip', 2, 60_000)).toBe(true);
    expect(limiter.reserve('ip', 2, 60_000)).toBe(false);
  });
});

describe('bucketLimit (ROK-1833)', () => {
  it('defaults to 60 messages / 20 blobs per minute', () => {
    delete process.env.THROTTLE_DISABLED;
    delete process.env.VALHEIM_LINK_RATE_MESSAGES_PER_MIN;
    delete process.env.VALHEIM_LINK_RATE_BLOBS_PER_MIN;
    expect([bucketLimit('messages'), bucketLimit('blobs')]).toEqual([60, 20]);
  });

  it('honours an env override even with THROTTLE_DISABLED, which lifts only the default', () => {
    process.env.THROTTLE_DISABLED = 'true';
    process.env.VALHEIM_LINK_RATE_MESSAGES_PER_MIN = '3';
    delete process.env.VALHEIM_LINK_RATE_BLOBS_PER_MIN;
    expect([bucketLimit('messages'), bucketLimit('blobs')]).toEqual([3, null]);
  });
});

function setup(bucket: ValheimLinkBucket | undefined) {
  const limiter = new ValheimLinkRateLimiter();
  limiter.now = () => 0;
  const reflector = {
    getAllAndOverride: () => bucket,
  } as unknown as Reflector;
  const guard = new ValheimLinkRateLimitGuard(reflector, limiter);
  const setHeader = jest.fn();
  const ctxFor = (pelicanServerId: number): ExecutionContext =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
          valheimLink: {
            tokenId: 1,
            tokenHash: 'h',
            pelicanServerId,
            serverId: String(pelicanServerId),
          },
        }),
        getResponse: () => ({ setHeader }),
      }),
    }) as unknown as ExecutionContext;
  return { guard, setHeader, ctxFor };
}

describe('ValheimLinkRateLimitGuard (ROK-1833)', () => {
  it('the 3rd message from server A is 429 rate_limited with Retry-After; B is unaffected', () => {
    delete process.env.THROTTLE_DISABLED;
    process.env.VALHEIM_LINK_RATE_MESSAGES_PER_MIN = '2';
    const { guard, setHeader, ctxFor } = setup(undefined);
    expect(guard.canActivate(ctxFor(1))).toBe(true);
    expect(guard.canActivate(ctxFor(1))).toBe(true);
    let caught: unknown;
    try {
      guard.canActivate(ctxFor(1));
    } catch (e: unknown) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught instanceof HttpException && caught.getStatus()).toBe(429);
    expect(
      caught instanceof HttpException && caught.getResponse(),
    ).toMatchObject({
      code: 'rate_limited',
    });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '60');
    expect(guard.canActivate(ctxFor(2))).toBe(true);
  });
});

describe('ValheimLinkRateLimitGuard buckets (ROK-1833)', () => {
  it('blobs draw from their own budget', () => {
    delete process.env.THROTTLE_DISABLED;
    process.env.VALHEIM_LINK_RATE_MESSAGES_PER_MIN = '1';
    process.env.VALHEIM_LINK_RATE_BLOBS_PER_MIN = '1';
    const msgs = setup('messages');
    const blobs = setup('blobs');
    // One shared limiter, so a shared key would show up as a 429.
    const shared = new ValheimLinkRateLimiter();
    shared.now = () => 0;
    const reflect = (b: ValheimLinkBucket) =>
      ({ getAllAndOverride: () => b }) as unknown as Reflector;
    const mg = new ValheimLinkRateLimitGuard(reflect('messages'), shared);
    const bg = new ValheimLinkRateLimitGuard(reflect('blobs'), shared);
    expect(mg.canActivate(msgs.ctxFor(1))).toBe(true);
    expect(bg.canActivate(blobs.ctxFor(1))).toBe(true);
    expect(() => mg.canActivate(msgs.ctxFor(1))).toThrow(HttpException);
  });
});
