/**
 * ROK-1928 Codex P2-2 / P2-3 — the sync service's post-apply wiring: a
 * superseded apply (slug changed mid-fetch) reports `superseded` and touches
 * nothing; an applied (`ok`) run drops the guild's cached roster insights
 * AFTER the transaction has committed.
 */
import { Test } from '@nestjs/testing';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { SettingsService } from '../../../settings/settings.service';
import { BlizzardService } from '../blizzard.service';
import { BlizzardRosterSyncService } from './blizzard-roster-sync.service';
import {
  applyForeverRoster,
  type RosterApplyResult,
} from './blizzard-roster-sync.tx';
import { RosterInsightsCache } from './roster-insights/roster-insights.cache';

jest.mock('./blizzard-roster-sync.tx', () => ({
  applyForeverRoster: jest.fn(),
}));
jest.mock('../../../guilds/guild-core.queries', () => ({
  findHubGuild: jest.fn(() =>
    Promise.resolve({
      guild: {
        id: 7,
        gameId: 1,
        region: 'us',
        nameKey: 'night shift',
        kind: 'wow_guild',
        guildSlug: 'night-shift',
      },
      gameSlug: 'world-of-warcraft-forever',
    }),
  ),
}));
jest.mock('../forever-armory-switch', () => ({
  isForeverArmoryImportEnabled: jest.fn().mockResolvedValue(true),
}));
jest.mock('./guild-slug.helpers', () => ({
  isForeverGuildHub: jest.fn().mockReturnValue(true),
}));

const GUILD = { id: 7, gameId: 1, region: 'us', nameKey: 'night shift' };
const ROSTER = {
  members: [{ name: 'Ana', level: 60, classId: 8, rank: 0, blizzardId: 1 }],
};
const applied = (over: Partial<RosterApplyResult>): RosterApplyResult => ({
  stale: false,
  superseded: false,
  updated: 1,
  inserted: 0,
  flag: null,
  warnings: [],
  ...over,
});

let service: BlizzardRosterSyncService;
let order: string[];
const invalidateGuild = jest.fn((id: number) => order.push(`invalidate:${id}`));

beforeEach(async () => {
  order = [];
  invalidateGuild.mockClear();
  const db = {
    transaction: jest.fn(async (fn: (tx: string) => Promise<unknown>) => {
      const out = await fn('tx');
      order.push('commit');
      return out;
    }),
  };
  const mod = await Test.createTestingModule({
    providers: [
      BlizzardRosterSyncService,
      { provide: DrizzleAsyncProvider, useValue: db },
      {
        provide: BlizzardService,
        useValue: {
          fetchForeverGuildRoster: jest.fn().mockResolvedValue(ROSTER),
        },
      },
      { provide: SettingsService, useValue: {} },
      { provide: RosterInsightsCache, useValue: { invalidateGuild } },
    ],
  }).compile();
  service = mod.get(BlizzardRosterSyncService);
});

describe('BlizzardRosterSyncService post-apply wiring', () => {
  it('passes the fetched slug to the apply', async () => {
    jest.mocked(applyForeverRoster).mockResolvedValue(applied({}));
    await service.syncForeverGuildRoster(GUILD.id);
    expect(applyForeverRoster).toHaveBeenCalledWith(
      'tx',
      GUILD,
      'night-shift',
      ROSTER.members,
      expect.any(Date),
    );
  });

  it('invalidates the guild insights after the commit on an ok run', async () => {
    jest.mocked(applyForeverRoster).mockResolvedValue(applied({}));
    const res = await service.syncForeverGuildRoster(GUILD.id);
    expect(res).toEqual({ status: 'ok', updated: 1, inserted: 0 });
    expect(order).toEqual(['commit', `invalidate:${GUILD.id}`]);
  });

  it('a superseded apply reports superseded and invalidates nothing', async () => {
    jest
      .mocked(applyForeverRoster)
      .mockResolvedValue(applied({ superseded: true, updated: 0 }));
    expect(await service.syncForeverGuildRoster(GUILD.id)).toEqual({
      status: 'superseded',
    });
    expect(invalidateGuild).not.toHaveBeenCalled();
  });

  it('a stale apply invalidates nothing', async () => {
    jest
      .mocked(applyForeverRoster)
      .mockResolvedValue(applied({ stale: true, updated: 0 }));
    expect(await service.syncForeverGuildRoster(GUILD.id)).toEqual({
      status: 'stale',
    });
    expect(invalidateGuild).not.toHaveBeenCalled();
  });
});
