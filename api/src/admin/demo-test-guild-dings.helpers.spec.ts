/**
 * ROK-1919 — the seed-guild `withDings` rows: two inside the Recent dings
 * 30-day window, one just outside it; and the body flag parser.
 */
import { BadRequestException } from '@nestjs/common';
import { seedDingRows } from './demo-test-guild-dings.helpers';
import { parseSeedGuildBody } from './demo-test-guild.helpers';
import { RECENT_DINGS_WINDOW_DAYS } from '../plugins/wow-common/guilds/recent-dings/recent-dings.helpers';

const NOW = new Date('2026-10-28T12:00:00.000Z');
const DAY_MS = 86_400_000;

describe('seedDingRows', () => {
  const rows = seedDingRows(9, { linked: 1, unlinked: 2, old: 3 }, NOW);
  const ageDays = rows.map(
    (r) => (NOW.getTime() - r.occurredAt.getTime()) / DAY_MS,
  );

  it('writes one level-up per seeded member on the guild', () => {
    expect(rows.map((r) => [r.guildId, r.guildMemberId])).toEqual([
      [9, 1],
      [9, 2],
      [9, 3],
    ]);
    expect(rows.every((r) => r.toLevel > r.fromLevel)).toBe(true);
  });

  it('puts two dings inside the feed window and one outside it', () => {
    const inside = ageDays.filter((d) => d < RECENT_DINGS_WINDOW_DAYS);
    expect(inside).toHaveLength(2);
    expect(ageDays[2]).toBeGreaterThan(RECENT_DINGS_WINDOW_DAYS);
  });
});

describe('parseSeedGuildBody withDings', () => {
  it('defaults to false and accepts true', () => {
    expect(parseSeedGuildBody({ name: 'Ding Guild' }).withDings).toBe(false);
    expect(
      parseSeedGuildBody({ name: 'Ding Guild', withDings: true }).withDings,
    ).toBe(true);
  });

  it('rejects a non-boolean flag', () => {
    expect(() =>
      parseSeedGuildBody({ name: 'Ding Guild', withDings: 'yes' }),
    ).toThrow(new BadRequestException('withDings must be a boolean'));
  });
});
