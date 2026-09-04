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

// ROK-1374 (D3): the tie assertions below are CALLER-level. `openTieHold` is
// mocked (its own DB behaviour is not under test here) but
// `readTieFromTransitionError` is the REAL predicate, so these tests pin the
// exact error shapes that do and do not open a hold.
jest.mock('../quorum/quorum-check.helpers', () => ({
  checkBuildingQuorum: jest.fn(),
  checkVotingQuorum: jest.fn(),
}));
jest.mock('../tiebreaker/tie-hold.helpers', () => ({
  ...jest.requireActual('../tiebreaker/tie-hold.helpers'),
  openTieHold: jest.fn(),
}));
jest.mock('../lineups-transition.helpers', () => ({
  runStatusTransition: jest.fn(),
}));

import { BadRequestException as BadRequest } from '@nestjs/common';
import { checkVotingQuorum } from '../quorum/quorum-check.helpers';
import { openTieHold } from '../tiebreaker/tie-hold.helpers';
import { runStatusTransition } from '../lineups-transition.helpers';
import {
  LINEUP_GRACE_ADVANCE,
  LINEUP_PHASE_TRANSITION,
} from './lineup-phase.constants';

describe('LineupPhaseProcessor', () => {
  let processor: LineupPhaseProcessor;
  let mockDb: MockDb;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockDb = createDrizzleMock();

    const mockQueueService = {
      scheduleTransition: jest.fn(),
      cancelGraceAdvance: jest.fn(),
    } as unknown as LineupPhaseQueueService;

    // ROK-1253: settings + gateway + activityLog + lineupNotifications are
    // injected for the grace-advance path (rework routes through
    // runStatusTransition); the rehydration tests below don't exercise them.
    const mockSettings = { get: jest.fn() } as never;
    const mockGateway = { emitStatusChange: jest.fn() } as never;
    const mockEmbedSyncQueue = { enqueue: jest.fn() } as never;
    const mockActivityLog = { log: jest.fn() } as never;
    const mockLineupNotifications = {} as never;
    processor = new LineupPhaseProcessor(
      mockDb as never,
      mockQueueService,
      mockSettings,
      mockGateway,
      mockEmbedSyncQueue,
      mockActivityLog,
      mockLineupNotifications,
      // ROK-1473: entered-scheduling hook emitter (unused by these tests).
      { emit: jest.fn() } as never,
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

// ============================================================================
// ROK-1374 (D3) — record-then-swallow.
//
// `isExpectedTransitionNoop` is UNCHANGED (its four tests above still pass
// untouched). What changed is the caller: before swallowing a tie it opens a
// durable tie hold, so clearing the grace claim no longer means going silent.
// ============================================================================
describe('LineupPhaseProcessor — ROK-1374 tie hold', () => {
  const TIE = { tiedGameIds: [7, 9], voteCount: 3 };
  let mockDb: MockDb;
  let queue: { scheduleTransition: jest.Mock; cancelGraceAdvance: jest.Mock };
  let processor: LineupPhaseProcessor;

  const votingLineup = {
    id: 42,
    status: 'voting',
    autoAdvancePausedAt: null,
    pendingAdvanceAt: new Date(),
    phaseDeadline: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = createDrizzleMock();
    mockDb.limit.mockResolvedValue([votingLineup]);
    (openTieHold as jest.Mock).mockResolvedValue({ opened: true });
    queue = { scheduleTransition: jest.fn(), cancelGraceAdvance: jest.fn() };
    processor = new LineupPhaseProcessor(
      mockDb as never,
      queue as never,
      { get: jest.fn() } as never,
      {} as never,
      {} as never,
      { log: jest.fn() } as never,
      {} as never,
      { emit: jest.fn() } as never,
    );
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  const graceJob = { name: LINEUP_GRACE_ADVANCE, data: { lineupId: 42 } };
  const deadlineJob = {
    name: LINEUP_PHASE_TRANSITION,
    data: { lineupId: 42, targetStatus: 'decided' },
  };

  it('grace path: records the tie instead of silently clearing the banner', async () => {
    (checkVotingQuorum as jest.Mock).mockResolvedValue({
      ready: false,
      reason: 'tie awaiting a pick',
      tie: TIE,
    });

    await processor.process(graceJob as never);

    expect(openTieHold).toHaveBeenCalledTimes(1);
    expect(openTieHold).toHaveBeenCalledWith(mockDb, votingLineup, TIE);
    // The doomed transition is never attempted at all.
    expect(runStatusTransition).not.toHaveBeenCalled();
    // ...and the grace claim is still released (ROK-1253 deadlock fix intact).
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ pendingAdvanceAt: null }),
    );
  });

  it('deadline path: records the tie carried by the TIEBREAKER_REQUIRED 400', async () => {
    (runStatusTransition as jest.Mock).mockRejectedValue(
      new BadRequest({ message: 'TIEBREAKER_REQUIRED', ...TIE }),
    );

    await expect(
      processor.process(deadlineJob as never),
    ).resolves.toBeUndefined();

    expect(openTieHold).toHaveBeenCalledTimes(1);
    expect(openTieHold).toHaveBeenCalledWith(mockDb, votingLineup, TIE);
  });

  it('deadline path: a CAS-race conflict is NOT a tie and opens no hold', async () => {
    (runStatusTransition as jest.Mock).mockRejectedValue(
      new ConflictException('lost race'),
    );

    await expect(
      processor.process(deadlineJob as never),
    ).resolves.toBeUndefined();

    expect(openTieHold).not.toHaveBeenCalled();
  });

  // REWORK-4 shape: `lineup-auto-advance-grace.integration.spec.ts:1027`
  // rejects with a PLAIN Error, not a BadRequestException. It must keep taking
  // the generic-failure path — cancel + clear, no tie hold.
  it('grace path: a plain Error(TIEBREAKER_REQUIRED) stays a generic failure', async () => {
    (checkVotingQuorum as jest.Mock).mockResolvedValue({ ready: true });
    (runStatusTransition as jest.Mock).mockRejectedValue(
      new Error('TIEBREAKER_REQUIRED'),
    );

    await processor.process(graceJob as never);

    expect(openTieHold).not.toHaveBeenCalled();
    expect(queue.cancelGraceAdvance).toHaveBeenCalledWith(42);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ pendingAdvanceAt: null }),
    );
  });
});
