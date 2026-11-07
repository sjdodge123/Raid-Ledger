import { blizzardRosterFor, slugifyGuildName } from './guild-slug.helpers';

describe('slugifyGuildName (ROK-1928 A-1)', () => {
  it('lowercases and joins words with hyphens', () => {
    expect(slugifyGuildName('Ye Olde Guild')).toBe('ye-olde-guild');
  });

  it('strips apostrophes', () => {
    expect(slugifyGuildName("Knights' O'Brien")).toBe('knights-obrien');
  });

  it('trims and collapses whitespace runs', () => {
    expect(slugifyGuildName('  Dawn \t  Patrol  ')).toBe('dawn-patrol');
  });

  it('keeps non-ASCII letters', () => {
    expect(slugifyGuildName('Über Gilde')).toBe('über-gilde');
  });
});

describe('blizzardRosterFor (ROK-1928 A3)', () => {
  const row = {
    kind: 'wow_guild' as const,
    guildSlug: 'ye-olde-guild',
    blizzardRosterStatus: 'ok' as const,
    blizzardRosterSyncedAt: new Date('2026-11-06T10:00:00.000Z'),
  };

  it('maps a Forever wow_guild row', () => {
    expect(blizzardRosterFor(row, 'world-of-warcraft-forever')).toEqual({
      blizzardRoster: {
        guildSlug: 'ye-olde-guild',
        status: 'ok',
        syncedAt: '2026-11-06T10:00:00.000Z',
      },
    });
  });

  it('omits the field for another game', () => {
    expect(blizzardRosterFor(row, 'world-of-warcraft-classic')).toEqual({});
  });

  it('omits the field for a non-guild hub', () => {
    const server = { ...row, kind: 'game_server' as const };
    expect(blizzardRosterFor(server, 'world-of-warcraft-forever')).toEqual({});
  });
});
