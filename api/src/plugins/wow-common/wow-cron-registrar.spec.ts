import { Test, TestingModule } from '@nestjs/testing';
import { WowCronRegistrar } from './wow-cron-registrar';
import { CharactersService } from '../../characters/characters.service';

describe('WowCronRegistrar', () => {
  let registrar: WowCronRegistrar;
  let mockCharactersService: { syncAllCharacters: jest.Mock };

  beforeEach(async () => {
    mockCharactersService = {
      syncAllCharacters: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WowCronRegistrar,
        { provide: CharactersService, useValue: mockCharactersService },
      ],
    }).compile();

    registrar = module.get<WowCronRegistrar>(WowCronRegistrar);
  });

  describe('getCronJobs()', () => {
    it('should return one cron job for character auto-sync', () => {
      const jobs = registrar.getCronJobs();

      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toBe('character-auto-sync');
      expect(jobs[0].cronExpression).toBe('0 0 3,15 * * *');
      expect(typeof jobs[0].handler).toBe('function');
    });
  });

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

    it('should prevent concurrent syncs', async () => {
      let resolveSync: () => void;
      mockCharactersService.syncAllCharacters.mockImplementation(
        () =>
          new Promise<{ synced: number; failed: number }>((resolve) => {
            resolveSync = () => resolve({ synced: 1, failed: 0 });
          }),
      );

      const jobs = registrar.getCronJobs();
      const handler = jobs[0].handler;

      // Start first sync (will hang on the promise)
      const firstSync = handler();

      // Second sync should be skipped (isSyncing = true)
      await handler();

      expect(mockCharactersService.syncAllCharacters).toHaveBeenCalledTimes(1);

      // Complete the first sync
      resolveSync!();
      await firstSync;
    });

    it('should reset isSyncing flag after failure', async () => {
      mockCharactersService.syncAllCharacters
        .mockRejectedValueOnce(new Error('API down'))
        .mockResolvedValueOnce({ synced: 3, failed: 0 });

      const jobs = registrar.getCronJobs();
      const handler = jobs[0].handler;

      // First call fails
      await handler();

      // Second call should proceed (isSyncing reset)
      await handler();

      expect(mockCharactersService.syncAllCharacters).toHaveBeenCalledTimes(2);
    });
  });
});
