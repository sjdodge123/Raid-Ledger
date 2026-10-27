/**
 * ROK-1956 L2 — D-18 per-principal ingest rate limits: device path per device
 * AND per user, session path per user; two buckets; 429 + Retry-After.
 */
import {
  HttpException,
  InternalServerErrorException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CompanionIngestErrorSchema } from '@raid-ledger/contract';
import { CompanionDeviceRateLimiter } from '../devices/companion-device-link.limits';
import {
  callerRatePerMin,
  CompanionIngestRateBucket,
  CompanionIngestRateLimitGuard,
} from './companion-ingest-rate-limit.guard';
import type { CompanionIngestAuth } from './companion-ingest-request';

const ENV_KEYS = [
  'THROTTLE_DISABLED',
  'COMPANION_INGEST_RATE_MESSAGES_PER_DEVICE_PER_MIN',
  'COMPANION_INGEST_RATE_MESSAGES_PER_USER_PER_MIN',
  'COMPANION_INGEST_RATE_BLOBS_PER_DEVICE_PER_MIN',
  'COMPANION_INGEST_RATE_BLOBS_PER_USER_PER_MIN',
];
const saved = ENV_KEYS.map((k) => [k, process.env[k]] as const);
beforeEach(() => ENV_KEYS.forEach((k) => delete process.env[k]));
afterAll(() =>
  saved.forEach(([k, v]) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }),
);

const device = (deviceId: number, userId = 9): CompanionIngestAuth => ({
  userId,
  via: 'device',
  deviceId,
  tokenHash: 'h',
});
const session = (userId = 9): CompanionIngestAuth => ({
  userId,
  via: 'session',
  deviceId: null,
  tokenHash: null,
});

class BlobsRoute {}
CompanionIngestRateBucket('blobs')(BlobsRoute);
class MessagesRoute {}

function setup() {
  const guard = new CompanionIngestRateLimitGuard(
    new Reflector(),
    new CompanionDeviceRateLimiter(),
  );
  const run = (
    auth: CompanionIngestAuth | undefined,
    route: object = MessagesRoute,
  ) => {
    const res = { setHeader: jest.fn() };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ companionIngest: auth }),
        getResponse: () => res,
      }),
      getHandler: () => () => undefined,
      getClass: () => route,
    } as unknown as ExecutionContext;
    return { call: () => guard.canActivate(ctx), res };
  };
  return { run };
}

/** Allowed calls before the first 429. */
function allowance(run: () => { call: () => boolean }, max = 200): number {
  for (let i = 0; i < max; i += 1) {
    try {
      run().call();
    } catch (err: unknown) {
      if (err instanceof HttpException && err.getStatus() === 429) return i;
      throw err;
    }
  }
  return max;
}

describe('CompanionIngestRateLimitGuard (ROK-1956 D-18)', () => {
  it('device path: 30 messages/min per device, then 429 rate_limited + Retry-After', () => {
    const { run } = setup();
    expect(allowance(() => run(device(1)))).toBe(30);
    const { call, res } = run(device(1));
    let caught: unknown;
    try {
      call();
    } catch (err: unknown) {
      caught = err;
    }
    if (!(caught instanceof HttpException)) throw new Error('expected a 429');
    expect(CompanionIngestErrorSchema.parse(caught.getResponse()).code).toBe(
      'rate_limited',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Retry-After',
      expect.stringMatching(/^\d+$/),
    );
  });

  it('device path: the user cap (60) spans all of that user’s devices', () => {
    const { run } = setup();
    expect(allowance(() => run(device(1)))).toBe(30);
    expect(allowance(() => run(device(2)))).toBe(30);
    expect(allowance(() => run(device(3)))).toBe(0);
    expect(allowance(() => run(device(4, 10)))).toBe(30);
  });

  it('session path: 60 messages/min per user', () => {
    const { run } = setup();
    expect(allowance(() => run(session()))).toBe(60);
  });

  it('the blobs bucket is separate: 20/device, 40/user', () => {
    const { run } = setup();
    expect(allowance(() => run(device(1), BlobsRoute))).toBe(20);
    expect(allowance(() => run(device(1)))).toBe(30);
    expect(allowance(() => run(session(), BlobsRoute))).toBe(20);
  });

  it('env overrides apply; THROTTLE_DISABLED lifts the defaults only', () => {
    process.env.COMPANION_INGEST_RATE_MESSAGES_PER_DEVICE_PER_MIN = '3';
    const first = setup();
    expect(allowance(() => first.run(device(1)))).toBe(3);
    process.env.THROTTLE_DISABLED = 'true';
    const { run } = setup();
    expect(allowance(() => run(device(1)))).toBe(3);
    expect(allowance(() => run(session()), 100)).toBe(100);
  });

  it('runs only after the auth guard (no principal → 500)', () => {
    expect(() => setup().run(undefined).call()).toThrow(
      InternalServerErrorException,
    );
  });

  it('callerRatePerMin reports the tighter of the caller’s caps', () => {
    expect(callerRatePerMin('messages', 'device')).toBe(30);
    expect(callerRatePerMin('messages', 'session')).toBe(60);
    expect(callerRatePerMin('blobs', 'device')).toBe(20);
    process.env.THROTTLE_DISABLED = 'true';
    expect(callerRatePerMin('blobs', 'session')).toBeNull();
  });
});
