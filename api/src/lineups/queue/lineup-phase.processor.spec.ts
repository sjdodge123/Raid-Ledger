import { Logger, ConflictException, BadRequestException } from '@nestjs/common';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import {
  LineupPhaseProcessor,
  isExpectedTransitionNoop,
} from './lineup-phase.processor';
import { LineupPhaseQueueService } from './lineup-phase.queue';

describe('LineupPhaseProcessor', () => {
  let processor: LineupPhaseProcessor;
  let mockDb: MockDb;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockDb = createDrizzleMock();

    const mockQueueService = {
      scheduleTransition: jest.fn(),
    } as unknown as LineupPhaseQueueService;

    // ROK-1253: settings + gateway + activityLog + lineupNotifications are
    // injected for the grace-advance path (rework routes through
    // runStatusTransition); the rehydration tests below don't exercise them.
    const mockSettings = { get: jest.fn() } as never;
    const mockGateway = { emitStatusChange: jest.fn() } as never;
    const mockActivityLog = { log: jest.fn() } as never;
    const mockLineupNotifications = {} as never;
    processor = new LineupPhaseProcessor(
      mockDb as never,
      mockQueueService,
      mockSettings,
      mockGateway,
      mockActivityLog,
      mockLineupNotifications,
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

  // ROK-1363 (Codex P1): the deadline path swallows only EXPECTED no-op
  // outcomes; every other error must propagate so BullMQ retries the job.
  describe('isExpectedTransitionNoop', () => {
    it('treats a CAS-race ConflictException as a no-op', () => {
      expect(isExpectedTransitionNoop(new ConflictException('lost race'))).toBe(
        true,
      );
    });

    it('treats a TIEBREAKER_REQUIRED BadRequest as a no-op', () => {
      const err = new BadRequestException({ message: 'TIEBREAKER_REQUIRED' });
      expect(isExpectedTransitionNoop(err)).toBe(true);
    });

    it('does NOT swallow other BadRequest errors (rethrow → retry)', () => {
      const err = new BadRequestException('Invalid transition');
      expect(isExpectedTransitionNoop(err)).toBe(false);
    });

    it('does NOT swallow transient/unexpected errors (rethrow → retry)', () => {
      expect(isExpectedTransitionNoop(new Error('db connection reset'))).toBe(
        false,
      );
      expect(isExpectedTransitionNoop('plain string')).toBe(false);
      expect(isExpectedTransitionNoop(undefined)).toBe(false);
    });
  });
});
