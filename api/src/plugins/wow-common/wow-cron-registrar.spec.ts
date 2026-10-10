import { Test, TestingModule } from '@nestjs/testing';
import { WowCronRegistrar } from './wow-cron-registrar';
import { CharactersService } from '../../characters/characters.service';
import { BossDataRefreshService } from './boss-data-refresh.service';
import { ForeverNamespaceProbeService } from './forever-namespace-probe.service';
import { WowItemMetaService } from './wowhead-item/wow-item-meta.service';
import { at } from '../../common/testing/narrow';

let registrar: WowCronRegistrar;
let mockCharactersService: { syncAllCharacters: jest.Mock };
let mockBossDataRefresh: { refresh: jest.Mock };
let mockProbe: { run: jest.Mock; runIfInLaunchWindow: jest.Mock };
let mockItemMeta: { retryDue: jest.Mock };

async function setupEach() {
  mockCharactersService = {
    syncAllCharacters: jest.fn(),
  };
  mockBossDataRefresh = {
    refresh: jest.fn(),
  };
  mockProbe = { run: jest.fn(), runIfInLaunchWindow: jest.fn() };
  mockItemMeta = { retryDue: jest.fn().mockResolvedValue(0) };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      WowCronRegistrar,
      { provide: CharactersService, useValue: mockCharactersService },
      { provide: BossDataRefreshService, useValue: mockBossDataRefresh },
      { provide: ForeverNamespaceProbeService, useValue: mockProbe },
      { provide: WowItemMetaService, useValue: mockItemMeta },
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
    expect(jobs).toHaveLength(5);
    expect(jobs[0]?.name).toBe('character-auto-sync');
    expect(jobs[0]?.cronExpression).toBe('0 0 3,15 * * *');
    expect(typeof at(jobs, 0).handler).toBe('function');
    expect(jobs[1]?.name).toBe('boss-data-refresh');
    expect(jobs[1]?.cronExpression).toBe('0 0 4 * * 0');
    expect(typeof at(jobs, 1).handler).toBe('function');
  });

  it('registers the daily and launch-window Forever probe jobs (ROK-1716 D7)', () => {
    const jobs = registrar.getCronJobs();
    expect(jobs[2]?.name).toBe('forever-namespace-probe');
    expect(jobs[2]?.cronExpression).toBe('0 0 5 * * *');
    expect(jobs[3]?.name).toBe('forever-namespace-probe-launch');
    expect(jobs[3]?.cronExpression).toBe('0 30 * * * *');
  });

  it('registers the daily Wowhead item retry job (ROK-1727)', async () => {
    const job = registrar.getCronJobs()[4];
    expect(job?.name).toBe('wowhead-item-retry');
    expect(job?.cronExpression).toBe('0 15 5 * * *');
    await job?.handler();
    expect(mockItemMeta.retryDue).toHaveBeenCalledTimes(1);
  });
});

/** Find a registered job's handler by name. */
function handlerFor(name: string): () => Promise<void> {
  const job = registrar.getCronJobs().find((j) => j.name === name);
  if (!job) throw new Error(`no cron job ${name}`);
  return async () => job.handler();
}

describe('WowCronRegistrar — Forever probe handlers (ROK-1716)', () => {
  beforeEach(() => setupEach());

  it('daily job runs the probe', async () => {
    mockProbe.run.mockResolvedValue({ status: 'ok' });
    await handlerFor('forever-namespace-probe')();
    expect(mockProbe.run).toHaveBeenCalledTimes(1);
    expect(mockProbe.runIfInLaunchWindow).not.toHaveBeenCalled();
  });

  it('daily job throws when the probe result is an error', async () => {
    mockProbe.run.mockResolvedValue({ status: 'error' });
    await expect(handlerFor('forever-namespace-probe')()).rejects.toThrow(
      /Forever namespace probe failed/,
    );
  });

  it('daily job resolves when the probe is skipped', async () => {
    mockProbe.run.mockResolvedValue({ status: 'skipped' });
    await expect(
      handlerFor('forever-namespace-probe')(),
    ).resolves.toBeUndefined();
  });

  it('launch job goes through the launch-window gate, never run()', async () => {
    mockProbe.runIfInLaunchWindow.mockResolvedValue(null);
    await expect(
      handlerFor('forever-namespace-probe-launch')(),
    ).resolves.toBeUndefined();
    expect(mockProbe.runIfInLaunchWindow).toHaveBeenCalledTimes(1);
    expect(mockProbe.run).not.toHaveBeenCalled();
  });

  it('launch job throws when an in-window run errors', async () => {
    mockProbe.runIfInLaunchWindow.mockResolvedValue({ status: 'error' });
    await expect(
      handlerFor('forever-namespace-probe-launch')(),
    ).rejects.toThrow(/Forever namespace probe failed/);
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
