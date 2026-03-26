import { Logger } from '@nestjs/common';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { LineupPhaseProcessor } from './lineup-phase.processor';
import { LineupPhaseQueueService } from './lineup-phase.queue';
import { SettingsService } from '../../settings/settings.service';

describe('LineupPhaseProcessor', () => {
  let processor: LineupPhaseProcessor;
  let mockDb: MockDb;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockDb = createDrizzleMock();

    const mockQueueService = {
      scheduleTransition: jest.fn(),
    } as unknown as LineupPhaseQueueService;

    const mockSettingsService = {
      get: jest.fn(),
    } as unknown as SettingsService;

    processor = new LineupPhaseProcessor(
      mockDb as never,
      mockQueueService,
      mockSettingsService,
    );

    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe('onModuleInit', () => {
    it('resolves without throwing when rehydration fails', async () => {
      mockDb.where.mockRejectedValueOnce(new Error('DB connection refused'));

      await expect(processor.onModuleInit()).resolves.toBeUndefined();
    });

    it('logs the error when rehydration fails', async () => {
      mockDb.where.mockRejectedValueOnce(new Error('DB connection refused'));

      await processor.onModuleInit();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('LineupPhaseProcessor'),
        expect.any(String),
      );
    });

    it('resolves normally when rehydration succeeds', async () => {
      mockDb.where.mockResolvedValueOnce([]);

      await expect(processor.onModuleInit()).resolves.toBeUndefined();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
