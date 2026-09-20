/**
 * ROK-1604 — pure helpers behind the scheduling-poll expiry warning.
 */
import { leadsAtAll } from '@raid-ledger/contract';
import {
  buildExpiryWarnCopy,
  buildNoLeaderWarnCopy,
  formatLockLabel,
  hasFutureAnswer,
  isInWarnWindow,
  pickLeadingFutureSlot,
} from './scheduling-poll-expiry.helpers';

const NOW = new Date('2026-09-16T12:00:00.000Z');
const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;

/** A deadline `ms` after NOW. */
function after(ms: number): Date {
  return new Date(NOW.getTime() + ms);
}

describe('isInWarnWindow', () => {
  it('is false at 12h01m out', () => {
    expect(isInWarnWindow(after(12 * HOUR_MS + MIN_MS), NOW, 12)).toBe(false);
  });

  it('is true at exactly 12h out', () => {
    expect(isInWarnWindow(after(12 * HOUR_MS), NOW, 12)).toBe(true);
  });

  it('is true at 1 minute out', () => {
    expect(isInWarnWindow(after(MIN_MS), NOW, 12)).toBe(true);
  });

  it('is false once the deadline has passed (or is now)', () => {
    expect(isInWarnWindow(after(-MIN_MS), NOW, 12)).toBe(false);
    expect(isInWarnWindow(NOW, NOW, 12)).toBe(false);
  });
});

describe('formatLockLabel', () => {
  // 2026-09-17T02:30Z = Wed 7:30 PM in Los Angeles (PDT), Thu 2:30 AM UTC.
  const iso = '2026-09-17T02:30:00.000Z';

  it('formats "Lock in <Ddd h:mm A>" in the community timezone', () => {
    expect(formatLockLabel(iso, 'America/Los_Angeles')).toBe(
      'Lock in Wed 7:30 PM',
    );
    expect(formatLockLabel(iso, 'UTC')).toBe('Lock in Thu 2:30 AM');
  });

  it('falls back to UTC on a corrupt timezone instead of throwing', () => {
    expect(formatLockLabel(iso, 'Not/AZone')).toBe('Lock in Thu 2:30 AM');
  });

  it('never exceeds the 80-char Discord button cap', () => {
    expect(formatLockLabel(iso, 'UTC').length).toBeLessThanOrEqual(80);
  });
});

describe('buildExpiryWarnCopy', () => {
  const deadline = new Date('2026-09-16T20:00:00.000Z');
  const leading = '2026-09-17T02:30:00.000Z';

  it('names the game and embeds Discord relative + full timestamps', () => {
    const copy = buildExpiryWarnCopy('Valheim', deadline, leading, 'UTC');
    const deadlineUnix = Math.floor(deadline.getTime() / 1000);
    const leadingUnix = Math.floor(new Date(leading).getTime() / 1000);
    expect(copy.title).toBe('Your Valheim poll closes soon');
    expect(copy.message).toBe(
      `Nobody has locked in a time and the poll closes <t:${deadlineUnix}:R>. ` +
        `The leading time is <t:${leadingUnix}:f>.`,
    );
    expect(copy.lockLabel).toBe('Lock in Thu 2:30 AM');
  });
});

describe('leadsAtAll — the ONE leader floor (ROK-1617 item D)', () => {
  /** An order key carrying only the counts the floor reads. */
  const key = (voteCount: number, noCount: number) => ({
    id: 1,
    proposedTime: after(HOUR_MS),
    voteCount,
    noCount,
  });

  it('is false for a negative net score', () => {
    expect(leadsAtAll(key(1, 3))).toBe(false);
  });

  it('is false at net 0 with yes votes (D-Q1 ruling)', () => {
    expect(leadsAtAll(key(2, 2))).toBe(false);
  });

  it('is true for a positive net score', () => {
    expect(leadsAtAll(key(3, 1))).toBe(true);
    expect(leadsAtAll(key(1, 0))).toBe(true);
  });

  it('is false for an all-no slot and for an unanswered slot', () => {
    expect(leadsAtAll(key(0, 3))).toBe(false);
    expect(leadsAtAll(key(0, 0))).toBe(false);
  });

  it('treats a missing noCount as zero (pre-stance call sites)', () => {
    expect(
      leadsAtAll({ id: 1, proposedTime: after(HOUR_MS), voteCount: 1 }),
    ).toBe(true);
  });
});

describe('buildNoLeaderWarnCopy (ROK-1617 item D)', () => {
  it('says no time worked and carries no lock button label', () => {
    const deadline = new Date('2026-09-16T20:00:00.000Z');
    const copy = buildNoLeaderWarnCopy('Valheim', deadline);
    const deadlineUnix = Math.floor(deadline.getTime() / 1000);
    expect(copy.title).toBe('Your Valheim poll closes soon');
    expect(copy.message).toBe(
      `No time worked for the group yet and the poll closes ` +
        `<t:${deadlineUnix}:R>. Suggest a new time or start a new poll.`,
    );
    expect(copy).not.toHaveProperty('lockLabel');
  });
});

describe('pickLeadingFutureSlot', () => {
  const slot = (id: number, hours: number) => ({
    id,
    proposedTime: after(hours * HOUR_MS),
  });

  it('returns null when no future slot has a vote', () => {
    const slots = [slot(1, 5), slot(2, -5)];
    const votes = [{ slotId: 2 }, { slotId: 2 }];
    expect(pickLeadingFutureSlot(slots, votes, NOW)).toBeNull();
  });

  it('ignores past slots even when they have more votes', () => {
    const slots = [slot(1, -5), slot(2, 5)];
    const votes = [{ slotId: 1 }, { slotId: 1 }, { slotId: 2 }];
    expect(pickLeadingFutureSlot(slots, votes, NOW)).toEqual({
      slotId: 2,
      proposedTime: after(5 * HOUR_MS).toISOString(),
      voteCount: 1,
    });
  });

  it('breaks a vote tie by the earliest time (shared comparator)', () => {
    const slots = [slot(1, 9), slot(2, 3)];
    const votes = [{ slotId: 1 }, { slotId: 2 }];
    expect(pickLeadingFutureSlot(slots, votes, NOW)?.slotId).toBe(2);
  });

  it('picks the most-voted future slot', () => {
    const slots = [slot(1, 3), slot(2, 9)];
    const votes = [{ slotId: 1 }, { slotId: 2 }, { slotId: 2 }];
    expect(pickLeadingFutureSlot(slots, votes, NOW)?.slotId).toBe(2);
  });
});

/**
 * ROK-1617 follow-up: "has anybody answered?" must read the SAME future-slot
 * window the leader does. Counting every vote row meant a poll whose times had
 * all passed — five yes votes on dead slots — was told "No time worked for the
 * group yet", which is a statement about times nobody could still pick.
 */
describe('hasFutureAnswer', () => {
  const slot = (id: number, hours: number) => ({
    id,
    proposedTime: after(hours * HOUR_MS),
  });

  it('is false when every answered slot has already passed', () => {
    const slots = [slot(1, -5), slot(2, -2)];
    const votes = [{ slotId: 1 }, { slotId: 1 }, { slotId: 2 }];
    expect(hasFutureAnswer(slots, votes, NOW)).toBe(false);
  });

  it('is true for an answer on a future slot', () => {
    const slots = [slot(1, -5), slot(2, 5)];
    expect(hasFutureAnswer(slots, [{ slotId: 2 }], NOW)).toBe(true);
  });

  it('counts a "no" on a future slot as an answer', () => {
    const slots = [slot(1, 5)];
    const votes = [{ slotId: 1, stance: 'no' as const }];
    expect(hasFutureAnswer(slots, votes, NOW)).toBe(true);
  });

  it('is false with no votes at all', () => {
    expect(hasFutureAnswer([slot(1, 5)], [], NOW)).toBe(false);
  });
});

describe('pickLeadingFutureSlot — the leader floor (ROK-1617, item D)', () => {
  const slot = (id: number, hours: number) => ({
    id,
    proposedTime: after(hours * HOUR_MS),
  });
  const yes = (slotId: number) => ({ slotId, stance: 'yes' as const });
  const no = (slotId: number) => ({ slotId, stance: 'no' as const });

  it('never offers a negative-net time (operator: "No time worked")', () => {
    // 1 yes / 3 no → net −2. The old `voteCount > 0` floor led with it.
    const leader = pickLeadingFutureSlot(
      [slot(1, 5)],
      [yes(1), no(1), no(1), no(1)],
      NOW,
    );
    expect(leader).toBeNull();
  });

  it('does not lead on net 0 with yes votes (D-Q1 ruling)', () => {
    const leader = pickLeadingFutureSlot(
      [slot(1, 5)],
      [yes(1), yes(1), no(1), no(1)],
      NOW,
    );
    expect(leader).toBeNull();
  });

  it('still leads with a positive net despite anti-votes', () => {
    const leader = pickLeadingFutureSlot(
      [slot(1, 5)],
      [yes(1), yes(1), yes(1), no(1)],
      NOW,
    );
    expect(leader).toEqual({
      slotId: 1,
      proposedTime: after(5 * HOUR_MS).toISOString(),
      voteCount: 3,
    });
  });

  it('prefers a positive-net later slot over a negative-net earlier one', () => {
    const leader = pickLeadingFutureSlot(
      [slot(1, 3), slot(2, 9)],
      [yes(1), no(1), no(1), yes(2)],
      NOW,
    );
    expect(leader?.slotId).toBe(2);
  });

  it('returns null for an all-no slot and for a poll nobody answered', () => {
    expect(pickLeadingFutureSlot([slot(1, 5)], [no(1), no(1)], NOW)).toBeNull();
    expect(pickLeadingFutureSlot([slot(1, 5)], [], NOW)).toBeNull();
  });
});
