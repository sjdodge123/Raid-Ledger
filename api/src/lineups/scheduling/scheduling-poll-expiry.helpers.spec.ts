/**
 * ROK-1604 — pure helpers behind the scheduling-poll expiry warning.
 */
import {
  buildExpiryWarnCopy,
  formatLockLabel,
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
