import type { Logger } from '@nestjs/common';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import { CronRunBookkeeping } from './cron-job.bookkeeping';
import { PRUNE_EVERY_N_EXECUTIONS } from './cron-job.constants';

const FINISH = new Date('2026-01-01T00:00:01Z');
const VALUES = {
  status: 'completed',
  startedAt: FINISH,
  finishedAt: FINISH,
  durationMs: 0,
};

const row = (cronExpression: string) =>
  ({ id: 7, name: 'Job_7', cronExpression, lastRunAt: null }) as never;

function setup() {
  const db = createDrizzleMock();
  const logger = { warn: jest.fn() } as unknown as Logger;
  const book = new CronRunBookkeeping(db as never, logger, jest.fn());
  return { db, book };
}

describe('CronRunBookkeeping.deferRun (ROK-1380 part B)', () => {
  it('queues BOTH the execution row and last_run_at for a 5-minute job', () => {
    const { book } = setup();
    const job = row('*/5 * * * *');

    expect(book.recordDeps.deferRun(job, 'Job_7', VALUES)).toBe(true);

    expect(book.executions.pending).toEqual([
      { job, jobName: 'Job_7', values: VALUES },
    ]);
    expect(book.lastRun.pending.get(7)?.lastRunAt).toBe(FINISH);
  });

  it('queues nothing for an hourly job (written immediately)', () => {
    const { book } = setup();

    expect(book.recordDeps.deferRun(row('0 * * * *'), 'Job_7', VALUES)).toBe(
      false,
    );

    expect(book.executions.pending).toHaveLength(0);
    expect(book.lastRun.pending.size).toBe(0);
  });
});

describe('CronRunBookkeeping.countWritten', () => {
  it('prunes once the written-row count reaches the threshold, then resets', async () => {
    const { db, book } = setup();
    db.offset.mockResolvedValue([]); // nothing beyond the retention window

    await book.countWritten(7, PRUNE_EVERY_N_EXECUTIONS - 3);
    expect(db.delete).not.toHaveBeenCalled();
    // A flush that writes 3 rows at once crosses the threshold.
    await book.countWritten(7, 3);

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.where).toHaveBeenCalledTimes(1);
    expect(book.executionCounts.get(7)).toBe(0);
  });
});
