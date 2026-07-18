import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import {
  recordNoOp,
  recordCompleted,
  recordFailed,
  shouldUpdateLiveness,
  flushPendingUpdates,
} from './cron-job.helpers';
import { isForeignKeyViolation } from './cron-job.fk-recovery.helpers';

const mockJob = () => ({
  id: 42,
  name: 'test-job',
  cronExpression: '0 * * * *',
  source: 'core' as const,
  pluginSlug: null,
  description: null,
  category: 'Maintenance',
  paused: false,
  lastRunAt: null as Date | null,
  nextRunAt: null as Date | null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('recordNoOp', () => {
  it('should NOT call db.insert (zero DB writes)', () => {
    const mockDb = createDrizzleMock();
    const startedAt = new Date('2025-01-01T00:00:00Z');
    const finishedAt = new Date('2025-01-01T00:00:00.050Z');

    // recordNoOp is now synchronous, no DB at all
    recordNoOp('test-job', startedAt, finishedAt);

    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

describe('recordCompleted', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  it('should insert an execution row and update the job', async () => {
    mockDb.values.mockReturnValueOnce(undefined);
    const job = mockJob();
    const startedAt = new Date('2025-01-01T00:00:00Z');
    const finishedAt = new Date('2025-01-01T00:00:01Z');

    await recordCompleted(
      mockDb as any,
      job,
      'test-job',
      startedAt,
      finishedAt,
    );

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        cronJobId: 42,
        status: 'completed',
        durationMs: 1000,
      }),
    );
    expect(mockDb.update).toHaveBeenCalled();
  });
});

describe('recordFailed', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  it('should insert an execution row with error', async () => {
    mockDb.values.mockReturnValueOnce(undefined);
    const job = mockJob();
    const startedAt = new Date('2025-01-01T00:00:00Z');
    const finishedAt = new Date('2025-01-01T00:00:02Z');
    const mockLogger = { error: jest.fn() } as any;

    await recordFailed(
      mockDb as any,
      job,
      'test-job',
      startedAt,
      finishedAt,
      'boom',
      mockLogger,
    );

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        cronJobId: 42,
        status: 'failed',
        error: 'boom',
        durationMs: 2000,
      }),
    );
    expect(mockLogger.error).toHaveBeenCalled();
  });
});

describe('isForeignKeyViolation (ROK-1328)', () => {
  it('returns true when err.code === 23503', () => {
    expect(isForeignKeyViolation({ code: '23503' })).toBe(true);
  });

  it('returns true when err.cause.code === 23503 (drizzle-wrapped)', () => {
    expect(
      isForeignKeyViolation({ message: 'wrapped', cause: { code: '23503' } }),
    ).toBe(true);
  });

  it('returns false for unique-violation 23505', () => {
    expect(isForeignKeyViolation({ code: '23505' })).toBe(false);
  });

  it('returns false for non-objects and null', () => {
    expect(isForeignKeyViolation(null)).toBe(false);
    expect(isForeignKeyViolation('23503')).toBe(false);
    expect(isForeignKeyViolation(undefined)).toBe(false);
  });
});

describe('recordCompleted — FK self-heal (ROK-1328)', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  function fkError(): Error {
    return Object.assign(new Error('insert or update violates FK'), {
      code: '23503',
    });
  }

  it('re-resolves and retries the insert ONCE against the fresh id', async () => {
    const job = mockJob(); // stale id 42
    const fresh = { ...mockJob(), id: 99 }; // re-inserted same name, new id
    // First insert .values() rejects with FK; second (after reresolve) resolves.
    mockDb.values
      .mockRejectedValueOnce(fkError())
      .mockResolvedValueOnce(undefined);
    const reresolve = jest.fn().mockResolvedValue(fresh);
    const logger = { warn: jest.fn(), error: jest.fn() } as any;

    await recordCompleted(
      mockDb as any,
      job,
      'test-job',
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-01-01T00:00:01Z'),
      reresolve,
      logger,
    );

    expect(reresolve).toHaveBeenCalledTimes(1);
    expect(reresolve).toHaveBeenCalledWith('test-job');
    // Two insert attempts: original (failed) + retry (succeeded).
    expect(mockDb.values).toHaveBeenCalledTimes(2);
    expect(mockDb.values).toHaveBeenLastCalledWith(
      expect.objectContaining({ cronJobId: 99, status: 'completed' }),
    );
    // Post-insert update targets the fresh row.
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('skips the row (no throw, no retry) when the job is gone', async () => {
    const job = mockJob();
    mockDb.values.mockRejectedValueOnce(fkError());
    const reresolve = jest.fn().mockResolvedValue(null);
    const logger = { warn: jest.fn(), error: jest.fn() } as any;

    await expect(
      recordCompleted(
        mockDb as any,
        job,
        'gone-job',
        new Date('2025-01-01T00:00:00Z'),
        new Date('2025-01-01T00:00:01Z'),
        reresolve,
        logger,
      ),
    ).resolves.toBeUndefined();

    expect(reresolve).toHaveBeenCalledTimes(1);
    // Only the original insert attempt; no retry.
    expect(mockDb.values).toHaveBeenCalledTimes(1);
    // No job-timestamp update when nothing was inserted.
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('re-throws a non-FK error unchanged', async () => {
    const job = mockJob();
    mockDb.values.mockRejectedValueOnce(new Error('connection reset'));
    const reresolve = jest.fn();

    await expect(
      recordCompleted(
        mockDb as any,
        job,
        'test-job',
        new Date('2025-01-01T00:00:00Z'),
        new Date('2025-01-01T00:00:01Z'),
        reresolve,
        { warn: jest.fn(), error: jest.fn() } as any,
      ),
    ).rejects.toThrow('connection reset');
    expect(reresolve).not.toHaveBeenCalled();
  });
});

describe('flushPendingUpdates (ROK-1414 — batched flush)', () => {
  let mockDb: MockDb;
  const logger = { warn: jest.fn(), debug: jest.fn() } as any;

  beforeEach(() => {
    mockDb = createDrizzleMock();
    jest.clearAllMocks();
  });

  const pending = () =>
    new Map<number, { lastRunAt: Date; cronExpression: string }>([
      [
        1,
        {
          lastRunAt: new Date('2025-01-01T00:00:00Z'),
          cronExpression: '0 * * * *',
        },
      ],
      [
        2,
        {
          lastRunAt: new Date('2025-01-01T01:00:00Z'),
          cronExpression: '*/5 * * * *',
        },
      ],
      [
        3,
        {
          lastRunAt: new Date('2025-01-01T02:00:00Z'),
          cronExpression: '0 0 * * *',
        },
      ],
    ]);

  it('issues exactly ONE db statement for N>1 pending jobs', async () => {
    const map = pending();
    await flushPendingUpdates(mockDb as any, map, logger);

    // The whole flush is a single batched UPDATE — one execute, zero per-row updates.
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('drains the pending map so the next cycle is a no-op', async () => {
    const map = pending();
    await flushPendingUpdates(mockDb as any, map, logger);
    expect(map.size).toBe(0);

    await flushPendingUpdates(mockDb as any, map, logger);
    // Empty map ⇒ no additional statement issued.
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  it('does nothing (no statement) when the pending map is empty', async () => {
    await flushPendingUpdates(mockDb as any, new Map(), logger);
    expect(mockDb.execute).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('logs a warning and swallows a DB failure without throwing', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('boom'));
    await expect(
      flushPendingUpdates(mockDb as any, pending(), logger),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('shouldUpdateLiveness', () => {
  it('should return true when lastRunAt is null (first run)', () => {
    expect(shouldUpdateLiveness(null, 300_000)).toBe(true);
  });

  it('should return false when lastRunAt is recent', () => {
    const recent = new Date(Date.now() - 60_000); // 1 minute ago
    expect(shouldUpdateLiveness(recent, 300_000)).toBe(false);
  });

  it('should return true when lastRunAt is stale', () => {
    const stale = new Date(Date.now() - 600_000); // 10 minutes ago
    expect(shouldUpdateLiveness(stale, 300_000)).toBe(true);
  });

  it('should return true when exactly at the interval boundary', () => {
    const exact = new Date(Date.now() - 300_000); // exactly 5 minutes ago
    expect(shouldUpdateLiveness(exact, 300_000)).toBe(true);
  });
});
