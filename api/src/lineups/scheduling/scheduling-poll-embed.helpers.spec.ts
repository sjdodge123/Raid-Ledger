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
