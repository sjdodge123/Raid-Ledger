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
