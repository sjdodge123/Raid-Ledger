import { Test, TestingModule } from '@nestjs/testing';
import { WowCronRegistrar } from './wow-cron-registrar';
import { CharactersService } from '../../characters/characters.service';
import { BossDataRefreshService } from './boss-data-refresh.service';
import { WowItemMetaService } from './wowhead-item/wow-item-meta.service';
import { at } from '../../common/testing/narrow';
import { BlizzardRosterSyncJob } from './guilds/blizzard-roster-sync.job';
import { ForeverAutoLinkService } from './forever-auto-link/forever-auto-link.service';
import { RosterArmoryService } from './forever-armory-snapshot/roster-armory.service';
import { ForeverQuestAutoImportService } from './forever-quest-import/forever-quest-auto-import.service';

let registrar: WowCronRegistrar;
let mockCharactersService: { syncAllCharacters: jest.Mock };
let mockBossDataRefresh: { refresh: jest.Mock };
let mockItemMeta: { retryDue: jest.Mock; backfillBossLoot: jest.Mock };
let mockRosterJob: { run: jest.Mock };
let mockAutoLink: { runDue: jest.Mock };
let mockRosterArmory: { runDue: jest.Mock };
let mockQuestImport: { runWeekly: jest.Mock };

async function setupEach() {
  mockCharactersService = {
    syncAllCharacters: jest.fn(),
  };
  mockBossDataRefresh = {
    refresh: jest.fn(),
  };
  mockItemMeta = {
    retryDue: jest.fn().mockResolvedValue(0),
    backfillBossLoot: jest.fn().mockResolvedValue(0),
  };
  mockRosterJob = { run: jest.fn().mockResolvedValue(null) };
  mockAutoLink = { runDue: jest.fn().mockResolvedValue(null) };
  mockRosterArmory = { runDue: jest.fn().mockResolvedValue(null) };
  mockQuestImport = { runWeekly: jest.fn().mockResolvedValue(undefined) };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      WowCronRegistrar,
      { provide: CharactersService, useValue: mockCharactersService },
      { provide: BossDataRefreshService, useValue: mockBossDataRefresh },
      { provide: WowItemMetaService, useValue: mockItemMeta },
      { provide: BlizzardRosterSyncJob, useValue: mockRosterJob },
      { provide: ForeverAutoLinkService, useValue: mockAutoLink },
      { provide: RosterArmoryService, useValue: mockRosterArmory },
      { provide: ForeverQuestAutoImportService, useValue: mockQuestImport },
    ],
  }).compile();

  registrar = module.get<WowCronRegistrar>(WowCronRegistrar);
}

async function testPreventConcurrentSyncs() {
  let resolveSync: () => void;
  mockCharactersService.syncAllCharacters.mockImplementation(
    () =>
      new Promise<{ synced: number; failed: number }>((resolve) => {
        resolveSync = () => resolve({ synced: 1, failed: 0 });
      }),
  );

  const jobs = registrar.getCronJobs();
  const handler = at(jobs, 0).handler;

  const firstSync = handler();
  await handler();

  expect(mockCharactersService.syncAllCharacters).toHaveBeenCalledTimes(1);

  resolveSync!();
  await firstSync;
}

describe('WowCronRegistrar — getCronJobs', () => {
  beforeEach(() => setupEach());

  it('should return cron jobs for character sync and boss data refresh', () => {
    const jobs = registrar.getCronJobs();
    expect(jobs).toHaveLength(7);
    expect(jobs[0]?.name).toBe('character-auto-sync');
    expect(jobs[0]?.cronExpression).toBe('0 0 3,15 * * *');
    expect(typeof at(jobs, 0).handler).toBe('function');
    expect(jobs[1]?.name).toBe('boss-data-refresh');
    expect(jobs[1]?.cronExpression).toBe('0 0 4 * * 0');
    expect(typeof at(jobs, 1).handler).toBe('function');
  });

  it('schedules no Forever namespace probe job — manual only (ROK-2163)', () => {
    const names = registrar.getCronJobs().map((j) => j.name);
    expect(
      names.filter((n) => n.startsWith('forever-namespace-probe')),
    ).toEqual([]);
    expect(names).toEqual([
      'character-auto-sync',
      'boss-data-refresh',
      'wowhead-item-retry',
      'forever-guild-roster-sync',
      'forever-armory-autolink',
      'forever-roster-armory',
      'forever-quest-import',
    ]);
  });

  it('registers the weekly Forever quest import refresh once (ROK-2162)', async () => {
    const jobs = registrar.getCronJobs();
    expect(jobs.filter((j) => j.name === 'forever-quest-import')).toHaveLength(
      1,
    );
    const job = jobs[6];
    expect(job?.name).toBe('forever-quest-import');
    expect(job?.cronExpression).toBe('0 30 6 * * 3');
    await expect(job?.handler()).resolves.toBeUndefined();
    expect(mockQuestImport.runWeekly).toHaveBeenCalledTimes(1);
  });

  it('registers the daily Wowhead item retry job (ROK-1727)', async () => {
    const job = registrar.getCronJobs()[2];
    expect(job?.name).toBe('wowhead-item-retry');
    expect(job?.cronExpression).toBe('0 15 5 * * *');
    await job?.handler();
    expect(mockItemMeta.retryDue).toHaveBeenCalledTimes(1);
  });

  it('the Wowhead retry job runs due re-probes, then the boss-loot backfill (ROK-2176)', async () => {
    const job = registrar.getCronJobs()[2];
    await job?.handler();
    expect(mockItemMeta.backfillBossLoot).toHaveBeenCalledTimes(1);
    const [retryOrder] = mockItemMeta.retryDue.mock.invocationCallOrder;
    const [backfillOrder] =
      mockItemMeta.backfillBossLoot.mock.invocationCallOrder;
    expect(retryOrder).toBeLessThan(backfillOrder ?? 0);
  });

  it('registers the 6-hourly Forever guild roster sync (ROK-1928 C1)', async () => {
    const job = registrar.getCronJobs()[3];
    expect(job?.name).toBe('forever-guild-roster-sync');
    expect(job?.cronExpression).toBe('0 20 */6 * * *');
    await expect(job?.handler()).resolves.toBeUndefined();
    expect(mockRosterJob.run).toHaveBeenCalledTimes(1);
  });

  it('registers the hourly Forever Armory auto-link job (ROK-2124)', async () => {
    const job = registrar.getCronJobs()[4];
    expect(job?.name).toBe('forever-armory-autolink');
    expect(job?.cronExpression).toBe('0 40 * * * *');
    await expect(job?.handler()).resolves.toBeUndefined();
    expect(mockAutoLink.runDue).toHaveBeenCalledTimes(1);
  });

  it('registers the hourly Forever roster Armory pass (ROK-2133 D3)', async () => {
    const job = registrar.getCronJobs()[5];
    expect(job?.name).toBe('forever-roster-armory');
    expect(job?.cronExpression).toBe('0 50 * * * *');
    await expect(job?.handler()).resolves.toBeUndefined();
    expect(mockRosterArmory.runDue).toHaveBeenCalledTimes(1);
  });
});

describe('WowCronRegistrar — handlers', () => {
  beforeEach(() => setupEach());

  describe('auto-sync handler', () => {
    it('should call syncAllCharacters', async () => {
      mockCharactersService.syncAllCharacters.mockResolvedValue({
        synced: 5,
        failed: 1,
      });
      const jobs = registrar.getCronJobs();
      await at(jobs, 0).handler();
      expect(mockCharactersService.syncAllCharacters).toHaveBeenCalledTimes(1);
    });

    it('should prevent concurrent syncs', () => testPreventConcurrentSyncs());

    it('should reset isSyncing flag after failure', async () => {
      mockCharactersService.syncAllCharacters
        .mockRejectedValueOnce(new Error('API down'))
        .mockResolvedValueOnce({ synced: 3, failed: 0 });
      const jobs = registrar.getCronJobs();
      const handler = at(jobs, 0).handler;
      await handler();
      await handler();
      expect(mockCharactersService.syncAllCharacters).toHaveBeenCalledTimes(2);
    });
  });

  describe('boss-data-refresh handler', () => {
    it('should call refresh()', async () => {
      mockBossDataRefresh.refresh.mockResolvedValue({ bosses: 10, loot: 50 });
      const jobs = registrar.getCronJobs();
      await at(jobs, 1).handler();
      expect(mockBossDataRefresh.refresh).toHaveBeenCalledTimes(1);
    });
  });
});
