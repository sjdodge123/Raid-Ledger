import type { SeriesSignupStateDto } from '@raid-ledger/contract';
import {
  buildSeriesCustomId,
  formatJoinSummary,
  formatJoinedReply,
  formatLeftReply,
  parseSeriesCustomId,
} from './series-signup-interaction.helpers';

const UUID = '0b6f2f4e-8f43-4f6a-9d7e-2a8b8c0d1e2f';

describe('series customId grammar', () => {
  it('round-trips action, event, character and roles', () => {
    const id = buildSeriesCustomId('series_confirm', 42, UUID, ['tank', 'dps']);
    expect(id).toBe(`series_confirm:42:${UUID}:tank,dps`);
    expect(parseSeriesCustomId(id)).toEqual({
      action: 'series_confirm',
      eventId: 42,
      characterId: UUID,
      roles: ['tank', 'dps'],
    });
  });

  it('uses - placeholders for missing picks and parses them back to null', () => {
    const id = buildSeriesCustomId('series_confirm', 7, null, null);
    expect(id).toBe('series_confirm:7:-:-');
    expect(parseSeriesCustomId(id)).toEqual({
      action: 'series_confirm',
      eventId: 7,
      characterId: null,
      roles: null,
    });
  });

  it('parses the bare series_join:<id> button from the embed', () => {
    expect(parseSeriesCustomId('series_join:99')).toEqual({
      action: 'series_join',
      eventId: 99,
      characterId: null,
      roles: null,
    });
  });

  it('rejects unknown actions, non-series ids and bad event ids', () => {
    expect(parseSeriesCustomId('signup:1')).toBeNull();
    expect(parseSeriesCustomId('series_bogus:1')).toBeNull();
    expect(parseSeriesCustomId('series_join:abc')).toBeNull();
    expect(parseSeriesCustomId('series_join')).toBeNull();
  });

  it('drops role values outside tank/healer/dps', () => {
    expect(parseSeriesCustomId('series_confirm:1:-:tank,mage')?.roles).toEqual([
      'tank',
    ]);
  });

  it('refuses to build a customId longer than Discord allows (100)', () => {
    expect(() =>
      buildSeriesCustomId('series_confirm', 1, 'x'.repeat(95), ['tank']),
    ).toThrow(/100/);
  });
});

function state(over: Partial<SeriesSignupStateDto>): SeriesSignupStateDto {
  return {
    membership: null,
    nights: [],
    joinableCount: 0,
    firstNight: null,
    lastNight: null,
    ...over,
  };
}

describe('reply copy', () => {
  it('summarises the joinable nights, the range and the declined nights', () => {
    const text = formatJoinSummary(
      state({
        joinableCount: 6,
        firstNight: '2026-10-21T19:00:00.000Z',
        lastNight: '2026-12-02T19:00:00.000Z',
        nights: [
          {
            eventId: 1,
            startTime: '2026-10-28T19:00:00.000Z',
            state: 'stays_inactive',
            signupStatus: 'declined',
          },
        ],
      }),
    );
    expect(text).toBe(
      'Sign up for the 6 upcoming nights (<t:1792609200:D> → <t:1796238000:D>). 1 night you declined stays declined.',
    );
  });

  it('uses the singular for one night and omits an empty declined line', () => {
    const text = formatJoinSummary(
      state({
        joinableCount: 1,
        firstNight: '2026-10-21T19:00:00.000Z',
        lastNight: '2026-10-21T19:00:00.000Z',
      }),
    );
    expect(text).toBe(
      'Sign up for the 1 upcoming night (<t:1792609200:D> → <t:1792609200:D>).',
    );
  });

  it('reports the joined count and any failed nights', () => {
    expect(
      formatJoinedReply({
        attachedEventIds: [1],
        createdEventIds: [2, 3],
        keptEventIds: [],
        failed: [{ eventId: 4, message: 'Roster full' }],
      }),
    ).toBe("You're in for 3 nights.\n1 night could not be joined.");
  });

  it('adds the <23h warning on leave when a cancelled night is late', () => {
    expect(
      formatLeftReply({
        cancelledEventIds: [1, 2],
        lateCancelledEventIds: [1],
        failed: [],
      }),
    ).toBe(
      "You've left the series — 2 nights cancelled.\n**Heads up:** 1 of them starts within 23 hours, so it counts as a late cancellation.",
    );
    expect(
      formatLeftReply({
        cancelledEventIds: [1],
        lateCancelledEventIds: [],
        failed: [],
      }),
    ).toBe("You've left the series — 1 night cancelled.");
  });

  it('tells the user which nights could not be cancelled and that they are still signed up (Codex P2)', () => {
    expect(
      formatLeftReply({
        cancelledEventIds: [1],
        lateCancelledEventIds: [],
        failed: [{ eventId: 2, message: 'cancel exploded' }],
      }),
    ).toBe(
      "You've left the series — 1 night cancelled.\n**Still signed up:** 1 night could not be cancelled (cancel exploded). Leave it from the event page.",
    );
    expect(
      formatLeftReply({
        cancelledEventIds: [],
        lateCancelledEventIds: [],
        failed: [
          { eventId: 2, message: 'boom' },
          { eventId: 3, message: 'boom' },
        ],
      }),
    ).toBe(
      "You've left the series — 0 nights cancelled.\n**Still signed up:** 2 nights could not be cancelled (boom). Leave them from each event page.",
    );
  });
});
