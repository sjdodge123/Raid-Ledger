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

const row = (cronExpression: string, id = 7) =>
  ({ id, name: 'Job_7', cronExpression, lastRunAt: null }) as never;

function setup() {
  const db = createDrizzleMock();
  const logger = { warn: jest.fn(), debug: jest.fn() } as unknown as Logger;
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

describe('CronRunBookkeeping.flush — re-created job (ROK-1380)', () => {
  it('moves a last_run_at queued under a stale id to the rebound fresh id', async () => {
    const { book } = setup();
    book.recordDeps.deferRun(row('*/5 * * * *'), 'Job_7', VALUES);
    jest
      .spyOn(book.executions, 'flush')
      .mockResolvedValue(new Map([[7, row('*/5 * * * *', 9)]]));
    let keysAtFlush: number[] = [];
    jest.spyOn(book.lastRun, 'flush').mockImplementation(() => {
      keysAtFlush = [...book.lastRun.pending.keys()];
      return Promise.resolve();
    });

    await book.flush();

    expect(keysAtFlush).toEqual([9]);
    expect(book.lastRun.pending.get(9)?.lastRunAt).toBe(FINISH);
  });

  it('keeps a newer value already queued for the fresh id', () => {
    const { book } = setup();
    const newer = new Date(FINISH.getTime() + 60_000);
    book.lastRun.pending.set(7, {
      lastRunAt: FINISH,
      cronExpression: '* * * * *',
    });
    book.lastRun.pending.set(9, {
      lastRunAt: newer,
      cronExpression: '* * * * *',
    });

    book.lastRun.rebind(7, { id: 9, cronExpression: '* * * * *' });

    expect([...book.lastRun.pending.keys()]).toEqual([9]);
    expect(book.lastRun.pending.get(9)?.lastRunAt).toBe(newer);
  });
});

describe('CronRunBookkeeping.flush — execution INSERT failed (ROK-1380)', () => {
  it('keeps that job’s last_run_at queued; other jobs still flush', async () => {
    const { db, book } = setup();
    book.recordDeps.deferRun(row('*/5 * * * *'), 'Job_7', VALUES);
    book.lastRun.pending.set(8, {
      lastRunAt: FINISH,
      cronExpression: '* * * * *',
    }); // a liveness heartbeat: no execution row
    // The INSERT failed: the buffer re-queued job 7's row and returned.
    jest.spyOn(book.executions, 'flush').mockResolvedValue(new Map());

    await book.flush();

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect([...book.lastRun.pending.keys()]).toEqual([7]);
  });

  it('holds a rebound job under its fresh id while its rows are queued', async () => {
    const { book } = setup();
    book.recordDeps.deferRun(row('*/5 * * * *'), 'Job_7', VALUES);
    jest
      .spyOn(book.executions, 'flush')
      .mockResolvedValue(new Map([[7, row('*/5 * * * *', 9)]]));

    await book.flush();

    expect([...book.lastRun.pending.keys()]).toEqual([9]);
  });
});

describe('LastRunBuffer.rebind — re-created job on a new schedule (ROK-1380)', () => {
  it('keeps the run timestamp but takes the FRESH row’s cron expression', () => {
    const { book } = setup();
    book.lastRun.pending.set(7, {
      lastRunAt: FINISH,
      cronExpression: '*/5 * * * *',
    });

    book.lastRun.rebind(7, { id: 9, cronExpression: '0 0 1 1 *' });

    expect(book.lastRun.pending.get(9)).toEqual({
      lastRunAt: FINISH,
      cronExpression: '0 0 1 1 *',
    });
  });
});

describe('CronRunBookkeeping.close — graceful shutdown (ROK-1380)', () => {
  it('stops deferring BEFORE the final flush, so later runs write directly', async () => {
    const { book } = setup();
    book.recordDeps.deferRun(row('*/5 * * * *'), 'Job_7', VALUES);
    let deferredDuringFlush: boolean | undefined;
    const flush = jest.spyOn(book, 'flush').mockImplementation(() => {
      // A run finishing while (or after) the final flush runs.
      deferredDuringFlush = book.recordDeps.deferRun(
        row('*/5 * * * *'),
        'Job_7',
        VALUES,
      );
      return Promise.resolve();
    });

    await book.close();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(deferredDuringFlush).toBe(false);
    expect(book.recordDeps.deferRun(row('*/5 * * * *'), 'Job_7', VALUES)).toBe(
      false,
    );
    expect(book.executions.pending).toHaveLength(1); // only the pre-close run
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
