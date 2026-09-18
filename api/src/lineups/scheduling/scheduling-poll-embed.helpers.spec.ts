/**
 * ROK-1545 — poll lifecycle derivation (`pollStatusFromMatch`).
 *
 * ONE helper feeds both the Discord embed and the web poll page, so the two
 * surfaces cannot disagree about what state a poll is in (audit F-01/F-02/
 * F-04). The interesting case is EXPIRED: the lineup-phase job archives the
 * parent lineup and leaves the match row on `scheduling` (prod match 49 /
 * lineup 26), so "expired" is only visible by reading lineup + match together.
 */
import { pollStatusFromMatch } from './scheduling-poll-embed.helpers';

describe('pollStatusFromMatch (ROK-1545)', () => {
  const NOW = new Date('2026-03-10T12:00:00.000Z');
  const PAST = new Date('2026-03-09T12:00:00.000Z');
  const FUTURE = new Date('2026-03-11T12:00:00.000Z');

  it('reads a live poll as open', () => {
    expect(pollStatusFromMatch({ matchStatus: 'scheduling', now: NOW })).toBe(
      'open',
    );
    expect(pollStatusFromMatch({ matchStatus: 'suggested', now: NOW })).toBe(
      'open',
    );
  });

  it('reads a scheduled match as locked_in', () => {
    expect(
      pollStatusFromMatch({
        matchStatus: 'scheduled',
        linkedEventId: 7,
        now: NOW,
      }),
    ).toBe('locked_in');
  });

  it('reads an archived match as cancelled, not merely closed', () => {
    expect(pollStatusFromMatch({ matchStatus: 'archived', now: NOW })).toBe(
      'cancelled',
    );
  });

  it('reads an archived LINEUP with a still-scheduling match as closed (expired)', () => {
    expect(
      pollStatusFromMatch({
        matchStatus: 'scheduling',
        lineupStatus: 'archived',
        now: NOW,
      }),
    ).toBe('closed');
  });

  it('reads a passed phase deadline with no lock-in as closed (expired)', () => {
    expect(
      pollStatusFromMatch({
        matchStatus: 'scheduling',
        phaseDeadline: PAST,
        now: NOW,
      }),
    ).toBe('closed');
  });

  it('keeps a poll open while its deadline is still ahead', () => {
    expect(
      pollStatusFromMatch({
        matchStatus: 'scheduling',
        phaseDeadline: FUTURE,
        now: NOW,
      }),
    ).toBe('open');
  });

  it('prefers locked_in over expiry when the poll produced an event', () => {
    expect(
      pollStatusFromMatch({
        matchStatus: 'scheduled',
        lineupStatus: 'archived',
        phaseDeadline: PAST,
        linkedEventId: 12,
        now: NOW,
      }),
    ).toBe('locked_in');
  });

  it('does not expire a scheduling match that already has a linked event', () => {
    expect(
      pollStatusFromMatch({
        matchStatus: 'scheduling',
        lineupStatus: 'archived',
        linkedEventId: 12,
        now: NOW,
      }),
    ).toBe('open');
  });

  it('accepts an ISO string deadline', () => {
    expect(
      pollStatusFromMatch({
        matchStatus: 'scheduling',
        phaseDeadline: PAST.toISOString(),
        now: NOW,
      }),
    ).toBe('closed');
  });
});

// ─────────────────────────────────────────────────────────────────────
// ROK-1545 review F2 — the embed must be able to reach `closed`, or an
// expired poll reads "Poll expired" on the page and still OPEN in Discord.
// ─────────────────────────────────────────────────────────────────────

describe('pollStatusFromMatch — expired polls (ROK-1545 F2)', () => {
  it('calls a still-scheduling match CLOSED once its lineup is archived', () => {
    expect(
      pollStatusFromMatch({
        matchStatus: 'scheduling',
        lineupStatus: 'archived',
        phaseDeadline: null,
        linkedEventId: null,
      }),
    ).toBe('closed');
  });

  it('calls it CLOSED once the phase deadline has passed', () => {
    expect(
      pollStatusFromMatch({
        matchStatus: 'scheduling',
        lineupStatus: 'decided',
        phaseDeadline: new Date('2020-01-01T00:00:00.000Z'),
        linkedEventId: null,
        now: new Date('2026-09-14T00:00:00.000Z'),
      }),
    ).toBe('closed');
  });

  it('leaves it OPEN while the deadline is still ahead', () => {
    expect(
      pollStatusFromMatch({
        matchStatus: 'scheduling',
        lineupStatus: 'decided',
        phaseDeadline: new Date('2999-01-01T00:00:00.000Z'),
        linkedEventId: null,
        now: new Date('2026-09-14T00:00:00.000Z'),
      }),
    ).toBe('open');
  });
});

// ─────────────────────────────────────────────────────────────────────
// ROK-1607 — the OTHER way a poll ends: the deadline is still hours out
// but every time on the poll is in the past. The prod card kept reading
// "▸ POLL OPEN · 1 voter" for a night that had already happened.
// ─────────────────────────────────────────────────────────────────────

describe('pollStatusFromMatch — every time has passed (ROK-1607)', () => {
  const NOW = new Date('2026-03-10T12:00:00.000Z');
  const PAST = new Date('2026-03-09T12:00:00.000Z');
  const EARLIER = new Date('2026-03-08T12:00:00.000Z');
  const FUTURE = new Date('2026-03-11T12:00:00.000Z');
  const LATER = new Date('2026-03-12T12:00:00.000Z');

  it('calls it CLOSED when every slot has passed but the deadline has not', () => {
    expect(
      pollStatusFromMatch({
        matchStatus: 'scheduling',
        phaseDeadline: LATER,
        slotTimes: [EARLIER, PAST],
        now: NOW,
      }),
    ).toBe('closed');
  });

  it('keeps it OPEN when one slot is still in the future', () => {
    expect(
      pollStatusFromMatch({
        matchStatus: 'scheduling',
        phaseDeadline: LATER,
        slotTimes: [PAST, FUTURE],
        now: NOW,
      }),
    ).toBe('open');
  });

  it('keeps a poll with no slots yet OPEN — nothing has passed', () => {
    expect(
      pollStatusFromMatch({
        matchStatus: 'scheduling',
        phaseDeadline: LATER,
        slotTimes: [],
        now: NOW,
      }),
    ).toBe('open');
  });

  it('closes a NULL-deadline poll once its last time passes', () => {
    expect(
      pollStatusFromMatch({
        matchStatus: 'scheduling',
        phaseDeadline: null,
        slotTimes: [PAST],
        now: NOW,
      }),
    ).toBe('closed');
    expect(
      pollStatusFromMatch({
        matchStatus: 'scheduling',
        phaseDeadline: null,
        slotTimes: [FUTURE],
        now: NOW,
      }),
    ).toBe('open');
  });

  it('skips the check entirely when the caller passed no slot times', () => {
    expect(
      pollStatusFromMatch({
        matchStatus: 'scheduling',
        phaseDeadline: LATER,
        now: NOW,
      }),
    ).toBe('open');
  });

  it('accepts ISO strings and ignores unparseable/absent times', () => {
    expect(
      pollStatusFromMatch({
        matchStatus: 'scheduling',
        slotTimes: [PAST.toISOString(), null, 'not-a-date'],
        now: NOW,
      }),
    ).toBe('closed');
    // A bad row on its own must never close a live poll.
    expect(
      pollStatusFromMatch({
        matchStatus: 'scheduling',
        slotTimes: ['not-a-date', undefined],
        now: NOW,
      }),
    ).toBe('open');
  });

  it('still prefers locked_in / cancelled over passed times', () => {
    expect(
      pollStatusFromMatch({
        matchStatus: 'scheduled',
        slotTimes: [PAST],
        now: NOW,
      }),
    ).toBe('locked_in');
    expect(
      pollStatusFromMatch({
        matchStatus: 'archived',
        slotTimes: [PAST],
        now: NOW,
      }),
    ).toBe('cancelled');
    // A lock-in that produced an event outranks expiry (existing rule).
    expect(
      pollStatusFromMatch({
        matchStatus: 'scheduling',
        linkedEventId: 12,
        slotTimes: [PAST],
        now: NOW,
      }),
    ).toBe('open');
  });
});
