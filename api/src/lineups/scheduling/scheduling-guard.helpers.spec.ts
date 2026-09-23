/**
 * ROK-1610 — `assertPollLockable` is NOT `assertPollOpen`.
 *
 * Voting closes the moment the deadline passes; finishing the poll does not.
 * These two guards deliberately disagree about an expired poll, and that
 * difference is the whole story — so it is pinned here, next to the proof
 * that the vote-side guard did not loosen.
 */
import { BadRequestException } from '@nestjs/common';
import { assertPollLockable, assertPollOpen } from './scheduling-guard.helpers';

/** A poll whose parent lineup the phase job archived (the prod expiry shape). */
const EXPIRED_LINEUP = { status: 'archived', phaseDeadline: null };
const LIVE_LINEUP = { status: 'decided', phaseDeadline: null };
const SCHEDULING = { status: 'scheduling', linkedEventId: null };

describe('assertPollLockable', () => {
  it('allows a lock-in on an OPEN poll and reports it open', () => {
    expect(assertPollLockable(SCHEDULING, LIVE_LINEUP)).toBe('open');
  });

  it('allows a lock-in on an EXPIRED poll and reports it closed (ROK-1610)', () => {
    expect(assertPollLockable(SCHEDULING, EXPIRED_LINEUP)).toBe('closed');
  });

  it('refuses a poll that is already locked in', () => {
    expect(() =>
      assertPollLockable(
        { status: 'scheduled', linkedEventId: 5 },
        LIVE_LINEUP,
      ),
    ).toThrow('Event already created for this match');
  });

  it('refuses a cancelled poll', () => {
    expect(() =>
      assertPollLockable(
        { status: 'archived', linkedEventId: null },
        LIVE_LINEUP,
      ),
    ).toThrow(BadRequestException);
  });

  it('tolerates a missing lineup row', () => {
    expect(assertPollLockable(SCHEDULING, undefined)).toBe('open');
  });
});

describe('assertPollOpen — the vote-side guard is unchanged', () => {
  it('still refuses a vote on an expired poll', () => {
    expect(() => assertPollOpen(SCHEDULING, EXPIRED_LINEUP)).toThrow(
      'This poll is no longer accepting votes',
    );
  });

  it('still allows a vote on a live poll', () => {
    expect(() => assertPollOpen(SCHEDULING, LIVE_LINEUP)).not.toThrow();
  });
});

describe('assertPollOpen — opt-in slot times (remind, batch 2026-09-22)', () => {
  const PAST = [new Date('2000-01-01T19:00:00.000Z')];
  const MIXED = [...PAST, new Date('2099-01-01T19:00:00.000Z')];

  it('refuses a live poll whose every time has passed when given the slots', () => {
    expect(() => assertPollOpen(SCHEDULING, LIVE_LINEUP, PAST)).toThrow(
      'This poll is no longer accepting votes',
    );
  });

  it('allows it while one time is still ahead', () => {
    expect(() => assertPollOpen(SCHEDULING, LIVE_LINEUP, MIXED)).not.toThrow();
  });

  it('ignores passed times when the caller omits the slots (vote / suggest)', () => {
    expect(() => assertPollOpen(SCHEDULING, LIVE_LINEUP)).not.toThrow();
  });
});
