import { Test, TestingModule } from '@nestjs/testing';
import { WowCronRegistrar } from './wow-cron-registrar';
import { CharactersService } from '../../characters/characters.service';
import { BossDataRefreshService } from './boss-data-refresh.service';

let registrar: WowCronRegistrar;
let mockCharactersService: { syncAllCharacters: jest.Mock };
let mockBossDataRefresh: { refresh: jest.Mock };

async function setupEach() {
  mockCharactersService = {
    syncAllCharacters: jest.fn(),
  };
  mockBossDataRefresh = {
    refresh: jest.fn(),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      WowCronRegistrar,
      { provide: CharactersService, useValue: mockCharactersService },
      { provide: BossDataRefreshService, useValue: mockBossDataRefresh },
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
  const handler = jobs[0].handler;

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
    expect(jobs).toHaveLength(2);
    expect(jobs[0].name).toBe('character-auto-sync');
    expect(jobs[0].cronExpression).toBe('0 0 3,15 * * *');
    expect(typeof jobs[0].handler).toBe('function');
    expect(jobs[1].name).toBe('boss-data-refresh');
    expect(jobs[1].cronExpression).toBe('0 0 4 * * 0');
    expect(typeof jobs[1].handler).toBe('function');
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
      await jobs[0].handler();
      expect(mockCharactersService.syncAllCharacters).toHaveBeenCalledTimes(1);
    });

    it('should prevent concurrent syncs', () => testPreventConcurrentSyncs());

    it('should reset isSyncing flag after failure', async () => {
      mockCharactersService.syncAllCharacters
        .mockRejectedValueOnce(new Error('API down'))
        .mockResolvedValueOnce({ synced: 3, failed: 0 });
      const jobs = registrar.getCronJobs();
      const handler = jobs[0].handler;
      await handler();
      await handler();
      expect(mockCharactersService.syncAllCharacters).toHaveBeenCalledTimes(2);
    });
  });

  describe('boss-data-refresh handler', () => {
    it('should call refresh()', async () => {
      mockBossDataRefresh.refresh.mockResolvedValue({ bosses: 10, loot: 50 });
      const jobs = registrar.getCronJobs();
      await jobs[1].handler();
      expect(mockBossDataRefresh.refresh).toHaveBeenCalledTimes(1);
    });
  });
});
