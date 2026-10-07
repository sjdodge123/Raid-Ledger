import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import type { CronRunBookkeeping } from './cron-job.bookkeeping';
import { computeNextRun } from './cron-job.helpers';
import { CronJobService } from './cron-job.service';

const OLD = '*/5 * * * *';
const NEW = '*/10 * * * *';

const jobRow = (cronExpression: string) => ({
  id: 7,
  name: 'Test_schedule_job',
  cronExpression,
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

function setup() {
  const db = createDrizzleMock();
  const registry = {
    getCronJob: jest.fn(() => ({
      stop: jest.fn(),
      setTime: jest.fn(),
      start: jest.fn(),
    })),
  };
  const service = new CronJobService(db as never, registry as never);
  const deps = (service as unknown as { book: CronRunBookkeeping }).book
    .recordDeps;
  return { db, service, deps };
}

describe('CronJobService.updateSchedule with a queued last_run_at (ROK-1380)', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date('2025-01-01T00:02:00Z'),
      doNotFake: ['nextTick', 'queueMicrotask'],
    });
  });
  afterEach(() => jest.useRealTimers());

  it('complete -> updateSchedule -> flush writes next_run_at from the NEW expression', async () => {
    const newNext = computeNextRun(NEW)?.toISOString();
    expect(newNext).not.toBe(computeNextRun(OLD)?.toISOString());
    const { db, service, deps } = setup();
    const finishedAt = new Date('2025-01-01T00:01:00Z');
    const values = {
      status: 'completed',
      startedAt: finishedAt,
      finishedAt,
      durationMs: 0,
    };
    expect(deps.deferRun(jobRow(OLD), 'Test_schedule_job', values)).toBe(true);
    db.returning.mockResolvedValueOnce([jobRow(NEW)]);

    await service.updateSchedule(7, NEW);
    // The execution flush's parent pre-check finds job 7, so its queued row
    // lands and its last_run_at is not held back behind a re-queued row.
    db.where.mockResolvedValueOnce([{ id: 7 }]);
    await service.flushLastRunUpdates();

    const query = db.execute.mock.calls[0][0] as SQL;
    expect(new PgDialect().sqlToQuery(query).params.slice(-3)).toEqual([
      7,
      finishedAt.toISOString(),
      newNext,
    ]);
  });
});
