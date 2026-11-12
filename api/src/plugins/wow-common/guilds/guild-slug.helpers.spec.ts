import { BLIZZARD_GUILD_SLUG_PATTERN } from '@raid-ledger/contract';
import {
  blizzardGuildFor,
  blizzardRosterFor,
  slugifyGuildName,
} from './guild-slug.helpers';

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

  it('drops punctuation so the suggestion fits the slug pattern', () => {
    const slug = slugifyGuildName('Dr. Pepper, Salt & Co');
    expect(slug).toBe('dr-pepper-salt--co');
    expect(slug).toMatch(BLIZZARD_GUILD_SLUG_PATTERN);
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

describe('blizzardGuildFor (ROK-1170)', () => {
  const row = {
    kind: 'wow_guild' as const,
    foundedAt: new Date('2024-03-05T00:00:00.000Z'),
    blizzardSummaryStatus: 'disbanded' as const,
  };

  it('maps a Forever wow_guild row', () => {
    expect(blizzardGuildFor(row, 'world-of-warcraft-forever')).toEqual({
      blizzardGuild: {
        foundedAt: '2024-03-05T00:00:00.000Z',
        state: 'disbanded',
      },
    });
  });

  it('nulls pass through on a never-synced Forever guild', () => {
    const empty = { ...row, foundedAt: null, blizzardSummaryStatus: null };
    expect(blizzardGuildFor(empty, 'world-of-warcraft-forever')).toEqual({
      blizzardGuild: { foundedAt: null, state: null },
    });
  });

  it('is empty for a Classic wow_guild and for a community hub', () => {
    expect(blizzardGuildFor(row, 'world-of-warcraft-classic')).toEqual({});
    const community = { ...row, kind: 'game_community' as const };
    expect(blizzardGuildFor(community, 'world-of-warcraft-forever')).toEqual(
      {},
    );
  });
});
