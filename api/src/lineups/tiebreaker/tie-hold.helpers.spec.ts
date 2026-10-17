/**
 * ROK-1374 — the pure parts of the tie hold (D4 / D13).
 *
 * `openTieHold` / `expireTieHold` run against real Postgres in
 * `lineup-tie-hold.integration.spec.ts`; the processor spec exercises
 * `readTieFromTransitionError` through the deadline path. What is pinned here
 * is the arithmetic and the projection nothing else states outright.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import type * as schema from '../../drizzle/schema';
import {
  TIE_HOLD_GRACE_MS,
  computeTieExpiresAt,
  deriveTieHold,
  readTieFromTransitionError,
} from './tie-hold.helpers';

type LineupRow = typeof schema.communityLineups.$inferSelect;

const DETECTED = new Date('2026-09-10T12:00:00.000Z');
const WEEK = TIE_HOLD_GRACE_MS;

function lineup(over: Partial<LineupRow> = {}): LineupRow {
  return {
    tieDetectedAt: null,
    tieGameIds: null,
    tieVoteCount: null,
    tieExpiresAt: null,
    tieExpiredAt: null,
    tiePickGameId: null,
    tiePickAt: null,
    tiePickBy: null,
    tieAnnounceChannelId: null,
    tieAnnounceMessageId: null,
    ...over,
  } as LineupRow;
}

describe('computeTieExpiresAt (D13)', () => {
  it('is a full week past the phase deadline when detection came EARLY', () => {
    const deadline = new Date(DETECTED.getTime() + 3 * 24 * 60 * 60 * 1000);
    expect(computeTieExpiresAt(deadline, DETECTED)).toEqual(
      new Date(deadline.getTime() + WEEK),
    );
  });

  it('is a full week past detection when detection came AT or after the deadline', () => {
    const deadline = new Date(DETECTED.getTime() - 60_000);
    expect(computeTieExpiresAt(deadline, DETECTED)).toEqual(
      new Date(DETECTED.getTime() + WEEK),
    );
  });

  it('falls back to detection + a week when the lineup has no phase deadline', () => {
    expect(computeTieExpiresAt(null, DETECTED)).toEqual(
      new Date(DETECTED.getTime() + WEEK),
    );
  });
});

describe('deriveTieHold — status precedence', () => {
  it('is none until a tie is detected', () => {
    expect(deriveTieHold(lineup()).status).toBe('none');
    expect(deriveTieHold(lineup()).tiedGameIds).toEqual([]);
  });

  it('is awaiting_pick once detected', () => {
    const state = deriveTieHold(
      lineup({ tieDetectedAt: DETECTED, tieGameIds: [7, 9], tieVoteCount: 3 }),
    );
    expect(state.status).toBe('awaiting_pick');
    expect(state.tiedGameIds).toEqual([7, 9]);
    expect(state.voteCount).toBe(3);
  });

  it('is picked once a mode was chosen', () => {
    expect(
      deriveTieHold(
        lineup({
          tieDetectedAt: DETECTED,
          tiePickAt: DETECTED,
          tiePickGameId: 7,
        }),
      ).status,
    ).toBe('picked');
  });

  it('expiry outranks a pick — an expired hold is terminal either way', () => {
    expect(
      deriveTieHold(
        lineup({
          tieDetectedAt: DETECTED,
          tiePickAt: DETECTED,
          tieExpiredAt: DETECTED,
        }),
      ).status,
    ).toBe('expired');
  });
});

describe('readTieFromTransitionError (D3 — deliberately narrow)', () => {
  it('reads the guard payload from the TIEBREAKER_REQUIRED 400', () => {
    const err = new BadRequestException({
      message: 'TIEBREAKER_REQUIRED',
      tiedGameIds: [7, 9],
      voteCount: 2,
    });
    expect(readTieFromTransitionError(err)).toEqual({
      tiedGameIds: [7, 9],
      voteCount: 2,
    });
  });

  it.each([
    [
      'a plain Error with the same text (REWORK-4 shape)',
      new Error('TIEBREAKER_REQUIRED'),
    ],
    ['a CAS-race conflict', new ConflictException('lost the race')],
    [
      'a payload-less TIEBREAKER_REQUIRED',
      new BadRequestException({ message: 'TIEBREAKER_REQUIRED' }),
    ],
    [
      'an empty tied list',
      new BadRequestException({
        message: 'TIEBREAKER_REQUIRED',
        tiedGameIds: [],
        voteCount: 2,
      }),
    ],
    [
      'a missing vote count',
      new BadRequestException({
        message: 'TIEBREAKER_REQUIRED',
        tiedGameIds: [7, 9],
      }),
    ],
    ['a string', 'TIEBREAKER_REQUIRED'],
  ])('yields null for %s', (_label, err) => {
    expect(readTieFromTransitionError(err)).toBeNull();
  });

  it('drops non-numeric ids and keeps the rest', () => {
    const err = new BadRequestException({
      message: 'TIEBREAKER_REQUIRED',
      tiedGameIds: [7, 'nine', 9],
      voteCount: 1,
    });
    expect(readTieFromTransitionError(err)).toEqual({
      tiedGameIds: [7, 9],
      voteCount: 1,
    });
  });
});
