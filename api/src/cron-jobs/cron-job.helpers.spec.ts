import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import {
  recordNoOp,
  recordCompleted,
  recordFailed,
  shouldUpdateLiveness,
} from './cron-job.helpers';

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
      job as any,
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
      job as any,
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
