/**
 * ROK-2015 D10 — `toGuildSummary` sends the rename fields per kind:
 * `nameOverridden` on server + WoW hubs, `inGameName` on WoW only.
 */
import { GuildSummarySchema } from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';
import { toGuildSummary } from './guild-core.queries';

const AT = new Date('2026-10-01T00:00:00Z');

const ROW: schema.GuildSelect = {
  id: 7,
  gameId: 9,
  kind: 'wow_guild',
  region: 'us',
  name: 'The Iron Lads',
  nameKey: 'iron vanguard',
  nameOverridden: true,
  sourceName: 'Iron Vanguard',
  realmSlug: null,
  guildSlug: null,
  faction: null,
  memberCount: 2,
  source: 'addon_import',
  lastSnapshotAt: null,
  rawRealm: null,
  pelicanServerId: null,
  hiddenAt: null,
  status: 'active',
  blurb: null,
  proposedBy: null,
  blizzardGuildId: null,
  reviewedBy: null,
  reviewedAt: null,
  archivedAt: null,
  archivedReason: null,
  autoMembership: 'off',
  createdAt: AT,
  updatedAt: AT,
};

describe('toGuildSummary — rename fields (ROK-2015 D10)', () => {
  it('a WoW guild carries nameOverridden and its in-game name', () => {
    const summary = toGuildSummary(ROW);
    expect(summary).toMatchObject({
      name: 'The Iron Lads',
      nameOverridden: true,
      inGameName: 'Iron Vanguard',
    });
    expect(GuildSummarySchema.safeParse(summary).success).toBe(true);
  });

  it('a WoW guild with no source name sends inGameName: null', () => {
    const summary = toGuildSummary({ ...ROW, sourceName: null });
    expect(summary.inGameName).toBeNull();
  });

  it('a server hub carries nameOverridden but no inGameName', () => {
    const summary = toGuildSummary({ ...ROW, kind: 'game_server' });
    expect(summary.nameOverridden).toBe(true);
    expect('inGameName' in summary).toBe(false);
  });

  it('a community hub carries neither field', () => {
    const summary = toGuildSummary({ ...ROW, kind: 'game_community' });
    expect('nameOverridden' in summary).toBe(false);
    expect('inGameName' in summary).toBe(false);
  });
});
