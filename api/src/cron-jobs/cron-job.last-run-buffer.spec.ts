import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import { NOOP_LIVENESS_INTERVAL_MS } from './cron-job.constants';
import { computeNextRun } from './cron-job.helpers';
import {
  LastRunBuffer,
  isDeferrableSchedule,
} from './cron-job.last-run-buffer';

const mockJob = (
  overrides: { id?: number; lastRunAt?: Date | null; cron?: string } = {},
) => ({
  id: overrides.id ?? 42,
  name: 'test-job',
  cronExpression: overrides.cron ?? '*/5 * * * *',
  source: 'core' as const,
  pluginSlug: null,
  description: null,
  category: 'Maintenance',
  paused: false,
  lastRunAt: overrides.lastRunAt ?? null,
  nextRunAt: null as Date | null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const logger = { warn: jest.fn(), debug: jest.fn() } as any;

describe('LastRunBuffer.deferCompleted (ROK-1380)', () => {
  it('queues the finish time + cron expression under job.id and returns true', () => {
    const buffer = new LastRunBuffer();
    const finishedAt = new Date('2025-01-01T00:00:01Z');

    expect(buffer.deferCompleted(mockJob(), finishedAt)).toBe(true);
    expect(buffer.pending.get(42)).toEqual({
      lastRunAt: finishedAt,
      cronExpression: '*/5 * * * *',
    });
  });

  it('returns false and queues nothing for a job marked immediate', () => {
    const buffer = new LastRunBuffer();
    buffer.markImmediate('test-job');

    expect(buffer.deferCompleted(mockJob(), new Date())).toBe(false);
    expect(buffer.pending.size).toBe(0);
  });

  it('consumes the immediate mark so the following run defers again', () => {
    const buffer = new LastRunBuffer();
    buffer.markImmediate('test-job');
    buffer.deferCompleted(mockJob(), new Date('2025-01-01T00:00:01Z'));

    const later = new Date('2025-01-01T00:05:01Z');
    expect(buffer.deferCompleted(mockJob(), later)).toBe(true);
    expect(buffer.pending.get(42)?.lastRunAt).toEqual(later);
  });

  it('drops an older queued value when an immediate write supersedes it', () => {
    const buffer = new LastRunBuffer();
    buffer.deferCompleted(mockJob(), new Date('2025-01-01T00:00:01Z'));
    buffer.markImmediate('test-job');

    expect(buffer.deferCompleted(mockJob(), new Date())).toBe(false);
    // A later flush must not roll the immediate write back to the old value.
    expect(buffer.pending.has(42)).toBe(false);
  });
});

describe('LastRunBuffer.deferCompleted — schedule gate (ROK-1380)', () => {
  it('writes a daily job immediately: returns false and queues nothing', () => {
    const buffer = new LastRunBuffer();
    const daily = mockJob({ cron: '0 0 0 * * *' });

    expect(buffer.deferCompleted(daily, new Date())).toBe(false);
    expect(buffer.pending.size).toBe(0);
  });

  it('consumes an immediate mark on a low-frequency job too', () => {
    const buffer = new LastRunBuffer();
    buffer.markImmediate('test-job');
    buffer.deferCompleted(mockJob({ cron: '0 * * * *' }), new Date());

    expect(buffer.deferCompleted(mockJob(), new Date())).toBe(true);
  });
});

describe('isDeferrableSchedule', () => {
  it.each([
    ['* * * * *', true],
    ['*/5 * * * *', true],
    ['*/15 * * * *', true],
    ['0 */30 * * * *', false],
    ['0 * * * *', false],
    ['0 0 0 * * *', false],
    ['0 0 6 * * 0', false],
    ['not a cron', false],
  ])('%s -> %s', (expression, expected) => {
    expect(isDeferrableSchedule(expression)).toBe(expected);
  });
});

describe('LastRunBuffer.queueLiveness', () => {
  it('queues and advances job.lastRunAt when the last run is stale', () => {
    const buffer = new LastRunBuffer();
    const stale = new Date(Date.now() - NOOP_LIVENESS_INTERVAL_MS - 1_000);
    const job = mockJob({ lastRunAt: stale });

    buffer.queueLiveness(job);

    const queued = buffer.pending.get(42);
    expect(queued?.cronExpression).toBe('*/5 * * * *');
    expect(queued?.lastRunAt.getTime()).toBeGreaterThan(stale.getTime());
    expect(job.lastRunAt).toBe(queued?.lastRunAt);
  });

  it('queues nothing and leaves job.lastRunAt alone when it is recent', () => {
    const buffer = new LastRunBuffer();
    const recent = new Date(Date.now() - 1_000);
    const job = mockJob({ lastRunAt: recent });

    buffer.queueLiveness(job);

    expect(buffer.pending.size).toBe(0);
    expect(job.lastRunAt).toBe(recent);
  });
});

describe('LastRunBuffer.flush', () => {
  it('writes every queued job in ONE statement and drains the buffer', async () => {
    const mockDb = createDrizzleMock();
    const buffer = new LastRunBuffer();
    buffer.deferCompleted(mockJob({ id: 1 }), new Date('2025-01-01T00:00:00Z'));
    buffer.deferCompleted(mockJob({ id: 2 }), new Date('2025-01-01T00:01:00Z'));

    await buffer.flush(mockDb as any, logger);

    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(buffer.pending.size).toBe(0);
  });
});

/** The (id, last_run_at, next_run_at) tuple bound into a one-row flush. */
function flushedRow(execute: jest.Mock): unknown[] {
  const query = execute.mock.calls[0][0] as SQL;
  return new PgDialect().sqlToQuery(query).params.slice(-3);
}

describe('LastRunBuffer.reschedule', () => {
  const OLD = '*/5 * * * *';
  const NEW = '*/10 * * * *';

  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date('2025-01-01T00:02:00Z'),
      doNotFake: ['nextTick', 'queueMicrotask'],
    });
  });
  afterEach(() => jest.useRealTimers());

  it('flushes next_run_at from the new expression for a run queued before it', async () => {
    const newNext = computeNextRun(NEW)?.toISOString();
    expect(newNext).not.toBe(computeNextRun(OLD)?.toISOString());
    const mockDb = createDrizzleMock();
    const buffer = new LastRunBuffer();
    const finishedAt = new Date('2025-01-01T00:01:00Z');
    buffer.deferCompleted(mockJob({ cron: OLD }), finishedAt);

    buffer.reschedule(42, NEW);
    await buffer.flush(mockDb as never, logger as never);

    expect(flushedRow(mockDb.execute)).toEqual([
      42,
      finishedAt.toISOString(),
      newNext,
    ]);
  });

  it('queues nothing for a job with no pending write', () => {
    const buffer = new LastRunBuffer();

    buffer.reschedule(42, NEW);

    expect(buffer.pending.size).toBe(0);
  });
});
