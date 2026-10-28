/**
 * ROK-1916 — the seed-guild `withPresence` rows: two members online at the
 * export, three away 1, 9 and 34 days; and the body flag parser.
 */
import { BadRequestException } from '@nestjs/common';
import { seedPresenceRows } from './demo-test-guild-presence.helpers';
import { parseSeedGuildBody } from './demo-test-guild.helpers';

const MEMBERS = { gm: 1, officer: 2, member: 4, unlinked: [3, 5] as const };

describe('seedPresenceRows', () => {
  const rows = seedPresenceRows(MEMBERS);

  it('marks the GM and officer online at the export', () => {
    expect(rows.filter((r) => r.onlineAtExport).map((r) => r.id)).toEqual([
      1, 2,
    ]);
  });

  it('marks the other three away 1, 9 and 34 days', () => {
    const away = rows.filter((r) => !r.onlineAtExport);
    expect(away.map((r) => [r.id, r.lastOnlineDays])).toEqual([
      [3, 1],
      [4, 9],
      [5, 34],
    ]);
  });
});

describe('parseSeedGuildBody withPresence', () => {
  it('defaults to false and accepts true', () => {
    expect(parseSeedGuildBody({ name: 'Seen Guild' }).withPresence).toBe(false);
    expect(
      parseSeedGuildBody({ name: 'Seen Guild', withPresence: true })
        .withPresence,
    ).toBe(true);
  });

  it('rejects a non-boolean flag', () => {
    expect(() =>
      parseSeedGuildBody({ name: 'Seen Guild', withPresence: 'yes' }),
    ).toThrow(new BadRequestException('withPresence must be a boolean'));
  });
});
