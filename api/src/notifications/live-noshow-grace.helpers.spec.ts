/**
 * Unit tests for the running-late grace helpers (ROK-1424).
 *
 * Pure-logic tier per TESTING.md. The end-to-end behaviour (Phase 1 skip,
 * Phase 2 exclusion, all-late suppression, deferred escalation) is covered by
 * live-noshow-running-late.integration.spec.ts against a real DB; this file
 * pins the arithmetic and the defensive coercions that the integration spec
 * cannot reach — notably non-positive `lateMinutes`, which no writer produces
 * today and which would otherwise go untested until someone adds one.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  DEFAULT_LATE_GRACE_MIN,
  fetchLateGraceByUserId,
  isSignupWithinLateGrace,
  isUserWithinLateGrace,
  lateDeadlineMs,
  type LateGraceByUserId,
} from './live-noshow-grace.helpers';

const MIN = 60_000;
const PHASE1 = 5 * MIN;
const PHASE2 = 15 * MIN;

describe('lateDeadlineMs', () => {
  it('stacks the grace on top of the phase offset', () => {
    expect(lateDeadlineMs(PHASE2, 30)).toBe(PHASE2 + 30 * MIN);
    expect(lateDeadlineMs(PHASE1, 45)).toBe(PHASE1 + 45 * MIN);
  });

  it('falls back to the default grace when no ETA was given', () => {
    expect(lateDeadlineMs(PHASE2, null)).toBe(
      PHASE2 + DEFAULT_LATE_GRACE_MIN * MIN,
    );
    expect(lateDeadlineMs(PHASE2, undefined)).toBe(
      PHASE2 + DEFAULT_LATE_GRACE_MIN * MIN,
    );
  });

  it('treats a non-positive ETA as the default, never as zero grace', () => {
    // A stored 0/-5 grants the DEFAULT window rather than collapsing the grace
    // to the bare phase offset. Defensive only — the contract constrains
    // late_minutes to a positive int and nothing writes it today.
    const expected = PHASE2 + DEFAULT_LATE_GRACE_MIN * MIN;
    expect(lateDeadlineMs(PHASE2, 0)).toBe(expected);
    expect(lateDeadlineMs(PHASE2, -5)).toBe(expected);
  });
});

describe('isSignupWithinLateGrace', () => {
  const late = { runningLateAt: new Date(), lateMinutes: null };

  it('is false when the signup is not flagged running late', () => {
    expect(
      isSignupWithinLateGrace(
        { runningLateAt: null, lateMinutes: null },
        99 * MIN,
        PHASE1,
      ),
    ).toBe(false);
  });

  it('is true while inside the extended window', () => {
    // Phase 1 fires at +5; a default grace pushes this player's deadline to +20.
    expect(isSignupWithinLateGrace(late, 19 * MIN, PHASE1)).toBe(true);
  });

  it('is false once the extended window has elapsed', () => {
    expect(isSignupWithinLateGrace(late, 20 * MIN, PHASE1)).toBe(false);
    expect(isSignupWithinLateGrace(late, 21 * MIN, PHASE1)).toBe(false);
  });

  it('honors an explicit ETA longer than the default', () => {
    const withEta = { runningLateAt: new Date(), lateMinutes: 30 };
    expect(isSignupWithinLateGrace(withEta, 40 * MIN, PHASE2)).toBe(true);
    expect(isSignupWithinLateGrace(withEta, 45 * MIN, PHASE2)).toBe(false);
  });
});

describe('isUserWithinLateGrace', () => {
  const grace: LateGraceByUserId = new Map([[7, DEFAULT_LATE_GRACE_MIN]]);

  it('is false for a user with no running-late marker', () => {
    expect(isUserWithinLateGrace(grace, 999, 0, PHASE2)).toBe(false);
  });

  it('is true inside and false outside the extended window', () => {
    expect(isUserWithinLateGrace(grace, 7, 29 * MIN, PHASE2)).toBe(true);
    expect(isUserWithinLateGrace(grace, 7, 30 * MIN, PHASE2)).toBe(false);
  });
});

describe('fetchLateGraceByUserId', () => {
  function stubDb(
    rows: Array<{ userId: number | null; lateMinutes: number | null }>,
  ) {
    return {
      select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
    } as unknown as PostgresJsDatabase<typeof schema>;
  }

  it('defaults a null ETA to the default grace', async () => {
    const grace = await fetchLateGraceByUserId(
      stubDb([{ userId: 1, lateMinutes: null }]),
      42,
    );
    expect(grace.get(1)).toBe(DEFAULT_LATE_GRACE_MIN);
  });

  it('keeps an explicit ETA', async () => {
    const grace = await fetchLateGraceByUserId(
      stubDb([{ userId: 1, lateMinutes: 30 }]),
      42,
    );
    expect(grace.get(1)).toBe(30);
  });

  it('skips anonymous Discord signups with no user_id', async () => {
    const grace = await fetchLateGraceByUserId(
      stubDb([
        { userId: null, lateMinutes: 30 },
        { userId: 2, lateMinutes: null },
      ]),
      42,
    );
    expect(grace.size).toBe(1);
    expect(grace.has(2)).toBe(true);
  });
});
