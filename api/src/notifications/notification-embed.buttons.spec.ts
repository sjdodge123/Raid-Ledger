/**
 * ROK-1604 — the scheduling-poll expiry warning DM's primary button.
 *
 * The creator's warning carries a one-tap `?lock=<slotId>` deep link labelled
 * with the leading time. The web page opens the lock-in CONFIRM from that
 * param (never commits), so the button is a plain Link. Other lineup subtypes
 * must keep the generic "Vote on a Time" link unchanged.
 */
import type { APIButtonComponentWithURL } from 'discord.js';
import { buildPrimaryButton } from './notification-embed.buttons';

const CLIENT = 'https://raid.example';

/** Serialize the built button so its label + URL can be asserted. */
function primary(
  payload: Record<string, unknown>,
): APIButtonComponentWithURL | null {
  const btn = buildPrimaryButton('community_lineup', 'n-1', payload, CLIENT);
  return btn ? (btn.toJSON() as APIButtonComponentWithURL) : null;
}

describe('buildPrimaryButton — scheduling_poll_expiry_warning (ROK-1604)', () => {
  const base = {
    subtype: 'scheduling_poll_expiry_warning',
    lineupId: 7,
    matchId: 42,
    slotId: 9,
  };

  it('links to the poll page with ?lock=<slotId>', () => {
    const json = primary({ ...base, lockLabel: 'Lock in Wed 7:00 PM' });
    expect(json?.url).toBe(`${CLIENT}/community-lineup/7/schedule/42?lock=9`);
  });

  it('uses the payload lockLabel as the button label', () => {
    const json = primary({ ...base, lockLabel: 'Lock in Wed 7:00 PM' });
    expect(json?.label).toBe('Lock in Wed 7:00 PM');
  });

  it('falls back to a generic label when lockLabel is missing', () => {
    expect(primary(base)?.label).toBe('Lock in a time');
  });

  it('truncates an over-long label to the 80-char Discord cap', () => {
    const json = primary({ ...base, lockLabel: `Lock in ${'x'.repeat(200)}` });
    expect(json?.label).toHaveLength(80);
  });

  it('without a slotId falls back to the generic vote link', () => {
    const json = primary({ ...base, slotId: undefined });
    expect(json?.label).toBe('Vote on a Time');
    expect(json?.url).toBe(`${CLIENT}/community-lineup/7/schedule/42`);
  });
});

describe('buildPrimaryButton — other lineup subtypes are unchanged', () => {
  it('keeps "Vote on a Time" for the vote nudge (no ?lock=)', () => {
    const json = primary({
      subtype: 'scheduling_poll_nudge',
      lineupId: 7,
      matchId: 42,
      slotId: 9,
    });
    expect(json?.label).toBe('Vote on a Time');
    expect(json?.url).toBe(`${CLIENT}/community-lineup/7/schedule/42`);
  });

  it('keeps "Vote Now" for event_rescheduling', () => {
    const json = primary({
      subtype: 'event_rescheduling',
      lineupId: 7,
      matchId: 42,
    });
    expect(json?.label).toBe('Vote Now');
  });

  it('keeps "View Event" for lineup_event_created', () => {
    const json = primary({ subtype: 'lineup_event_created', eventId: 3 });
    expect(json?.url).toBe(`${CLIENT}/events/3`);
  });

  it('keeps "View Lineup" when only a lineupId is present', () => {
    expect(primary({ lineupId: 7 })?.label).toBe('View Lineup');
  });
});
