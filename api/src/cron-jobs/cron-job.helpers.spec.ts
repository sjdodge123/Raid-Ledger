import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { recordNoOp } from './cron-job.helpers';

describe('recordNoOp', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  it('should insert a no-op execution row with zero duration', async () => {
    mockDb.values.mockReturnValueOnce(undefined);

    const job = {
      id: 42,
      name: 'test-job',
      cronExpression: '0 * * * *',
      source: 'core',
      pluginSlug: null,
      description: null,
      category: 'Maintenance',
      paused: false,
      lastRunAt: null,
      nextRunAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const startedAt = new Date('2025-01-01T00:00:00Z');
    const finishedAt = new Date('2025-01-01T00:00:00.050Z');

    await recordNoOp(
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
        status: 'no-op',
        startedAt,
        finishedAt,
        durationMs: 50,
      }),
    );
  });
});
