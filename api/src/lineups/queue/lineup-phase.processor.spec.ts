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
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('resolves without throwing when rehydration fails', async () => {
      mockDb.where.mockRejectedValue(new Error('DB connection refused'));

      const p = processor.onModuleInit();
      for (let i = 0; i < 3; i++) {
        await jest.advanceTimersByTimeAsync(10_000);
      }
      await expect(p).resolves.toBeUndefined();
    });

    it('logs the error when rehydration fails', async () => {
      mockDb.where.mockRejectedValue(new Error('DB connection refused'));

      const p = processor.onModuleInit();
      for (let i = 0; i < 3; i++) {
        await jest.advanceTimersByTimeAsync(10_000);
      }
      await p;

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
