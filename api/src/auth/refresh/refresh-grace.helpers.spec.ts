/**
 * ROK-1755 — the refresh race grace is ≤ 10 s and allows ONE sibling per
 * parent; later replays inside the window are `raced` (409, no token, NO
 * revoke — 3+ tabs on one cookie must not log themselves out). Only a replay
 * older than the window is reuse (family revoke + blocklist).
 */
import {
  ConflictException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createRedisMock } from '../../common/testing/redis-mock';
import {
  RACE_GRACE_MS,
  REFRESH_RACED_CODE,
  claimGraceOnce,
  indeterminateReplayError,
  replayVerdict,
  rotationAgeMs,
  IN_FLIGHT_MAX_MS,
  GRACE_KEY_TTL_MS,
  GRACE_KEY_MARGIN_MS,
} from './refresh-grace.helpers';

/** SET NX PX that honours the TTL against `Date.now()` (the shared mock does not expire NX keys). */
function expiringRedis() {
  const expiries = new Map<string, number>();
  return {
    set: (key: string, _v: string, _px: 'PX', ms: number) => {
      const until = expiries.get(key);
      if (until !== undefined && until > Date.now()) {
        return Promise.resolve(null);
      }
      expiries.set(key, Date.now() + ms);
      return Promise.resolve('OK' as string | null);
    },
  };
}

describe('refresh race grace (ROK-1755)', () => {
  it('window is at most 10 seconds', () => {
    expect(RACE_GRACE_MS).toBeLessThanOrEqual(10_000);
  });

  it('first replay in the window gets a sibling, the second is raced', async () => {
    const { client } = createRedisMock();
    const claim = () => claimGraceOnce(client, 'parent-1');
    expect(await replayVerdict(1_000, claim)).toBe('sibling');
    expect(await replayVerdict(2_000, claim)).toBe('raced');
  });

  it('concurrent replays of one parent: exactly one sibling', async () => {
    const { client } = createRedisMock();
    const claim = () => claimGraceOnce(client, 'parent-2');
    const verdicts = await Promise.all(
      [0, 1, 2].map(() => replayVerdict(500, claim)),
    );
    expect(verdicts.filter((v) => v === 'sibling')).toHaveLength(1);
    expect(verdicts.filter((v) => v === 'raced')).toHaveLength(2);
    expect(verdicts).not.toContain('reuse');
  });

  it('grace is per parent row', async () => {
    const { client } = createRedisMock();
    expect(await claimGraceOnce(client, 'a')).toBe('claimed');
    expect(await claimGraceOnce(client, 'b')).toBe('claimed');
  });

  it('replay older than the window is reuse without claiming', async () => {
    const claim = jest.fn();
    expect(await replayVerdict(RACE_GRACE_MS + 1, claim)).toBe('reuse');
    expect(claim).not.toHaveBeenCalled();
  });

  it('a Redis failure is unavailable (503) without escalating to reuse', async () => {
    const failing = { set: jest.fn().mockRejectedValue(new Error('down')) };
    const claim = () => claimGraceOnce(failing, 'parent-3');
    expect(await replayVerdict(100, claim)).toBe('unavailable');
  });

  it('claims with SET NX and a TTL covering grace + in-flight (ROK-1754 W1)', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    await claimGraceOnce({ set }, 'parent-4');
    expect(GRACE_KEY_TTL_MS).toBe(
      RACE_GRACE_MS + IN_FLIGHT_MAX_MS + GRACE_KEY_MARGIN_MS,
    );
    expect(GRACE_KEY_MARGIN_MS).toBeGreaterThan(0);
    expect(set).toHaveBeenCalledWith(
      'refresh_grace:parent-4',
      '1',
      'PX',
      GRACE_KEY_TTL_MS,
      'NX',
    );
  });
});

describe('grace once-key outlives the in-flight window (ROK-1754 W1)', () => {
  it('ROK-1754 W1: a second claim after a stall + re-stamp is still refused', async () => {
    // Consume at T0 then a stall: a replay at T0+1 s claims; the first child
    // lands at T0+14 s and re-stamps, so a replay at T0+20 s is in-window
    // again. It must NOT win a second sibling.
    const t0 = Date.parse('2026-10-11T12:07:02.074Z');
    const clock = jest.spyOn(Date, 'now');
    try {
      const client = expiringRedis();
      clock.mockReturnValue(t0 + 1_000);
      expect(await claimGraceOnce(client, 'stalled')).toBe('claimed');
      clock.mockReturnValue(t0 + 20_000);
      expect(await claimGraceOnce(client, 'stalled')).toBe('used');
      // The key outlives the latest possible in-window replay
      // (re-stamp capped at T0+60 s, + 10 s grace).
      clock.mockReturnValue(t0 + IN_FLIGHT_MAX_MS + RACE_GRACE_MS);
      expect(await claimGraceOnce(client, 'stalled')).toBe('used');
    } finally {
      clock.mockRestore();
    }
  });
});

describe('indeterminateReplayError (ROK-1755 review B1/M1)', () => {
  it('raced → 409 with code refresh_raced and no token', () => {
    const err = indeterminateReplayError('raced');
    expect(err).toBeInstanceOf(ConflictException);
    expect(err?.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(err?.getResponse()).toEqual({
      statusCode: 409,
      code: REFRESH_RACED_CODE,
      message: expect.any(String),
    });
  });

  it('unavailable → 503 (indeterminate to the web, not a 401 logout)', () => {
    const err = indeterminateReplayError('unavailable');
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err?.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('sibling and reuse are not indeterminate', () => {
    expect(indeterminateReplayError('sibling')).toBeNull();
    expect(indeterminateReplayError('reuse')).toBeNull();
  });
});

describe('rotationAgeMs (ROK-1754 — grace runs from child issue)', () => {
  // Fleet run 2c53b4959397: consumed 12:07:02.074, replayed 12:07:16.518.
  const incidentAgeMs = 14_444;

  it('a consumed row with no child yet is in flight: age 0, never reuse', async () => {
    const age = rotationAgeMs({
      rotatedAgoMs: incidentAgeMs,
      replacedBy: null,
    });
    expect(age).toBe(0);
    const { client } = createRedisMock();
    expect(await replayVerdict(age, () => claimGraceOnce(client, 'p'))).toBe(
      'sibling',
    );
  });

  it('once the child is issued the age is the DB-computed age', () => {
    const age = rotationAgeMs({
      rotatedAgoMs: incidentAgeMs,
      replacedBy: 'child',
    });
    expect(age).toBe(incidentAgeMs);
    expect(age).toBeGreaterThan(RACE_GRACE_MS);
  });

  it('an in-flight row stuck past IN_FLIGHT_MAX_MS ages normally', () => {
    expect(
      rotationAgeMs({ rotatedAgoMs: IN_FLIGHT_MAX_MS + 1, replacedBy: null }),
    ).toBe(IN_FLIGHT_MAX_MS + 1);
  });
});
