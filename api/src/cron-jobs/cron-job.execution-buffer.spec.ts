import type { Logger } from '@nestjs/common';
import {
  ExecutionBuffer,
  MAX_QUEUED_EXECUTIONS,
  type ExecutionFlushDeps,
} from './cron-job.execution-buffer';

const START = new Date('2026-01-01T00:00:00Z');
const FINISH = new Date('2026-01-01T00:00:01Z');
const VALUES = {
  status: 'completed',
  startedAt: START,
  finishedAt: FINISH,
  durationMs: 1000,
};

const job = (id: number, name = `Job_${id}`) =>
  ({ id, name, cronExpression: '*/5 * * * *' }) as never;

/** A db whose parent pre-check returns `liveIds` and whose INSERT obeys `insertImpl`. */
function setup(liveIds: number[], insertImpl?: jest.Mock) {
  const values = insertImpl ?? jest.fn().mockResolvedValue(undefined);
  const db = {
    select: jest.fn(() => ({
      from: () => ({
        where: jest.fn().mockResolvedValue(liveIds.map((id) => ({ id }))),
      }),
    })),
    insert: jest.fn(() => ({ values })),
  };
  const logger = { warn: jest.fn() } as unknown as Logger;
  const deps: ExecutionFlushDeps = {
    db: db as never,
    logger,
    reresolve: jest.fn().mockResolvedValue(null),
    onInserted: jest.fn().mockResolvedValue(undefined),
  };
  return { db, values, deps, buffer: new ExecutionBuffer() };
}

const fkError = () => Object.assign(new Error('fk'), { code: '23503' });

describe('ExecutionBuffer.flush — batching (ROK-1380 part B)', () => {
  it('writes N queued runs in ONE multi-row INSERT and drains', async () => {
    const { db, values, deps, buffer } = setup([1, 2]);
    buffer.enqueue(job(1), 'Job_1', VALUES);
    buffer.enqueue(job(1), 'Job_1', { ...VALUES, status: 'degraded' });
    buffer.enqueue(job(2), 'Job_2', VALUES);

    await buffer.flush(deps);

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith([
      { cronJobId: 1, ...VALUES },
      { cronJobId: 1, ...VALUES, status: 'degraded' },
      { cronJobId: 2, ...VALUES },
    ]);
    expect(buffer.pending).toHaveLength(0);
    expect(deps.onInserted).toHaveBeenCalledWith(1, 2);
    expect(deps.onInserted).toHaveBeenCalledWith(2, 1);
  });

  it('does nothing when nothing is queued', async () => {
    const { db, deps, buffer } = setup([]);
    await buffer.flush(deps);
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('drops the oldest rows past MAX_QUEUED_EXECUTIONS', () => {
    const { buffer } = setup([]);
    for (let i = 0; i <= MAX_QUEUED_EXECUTIONS; i++) {
      buffer.enqueue(job(i), `Job_${i}`, VALUES);
    }
    expect(buffer.pending).toHaveLength(MAX_QUEUED_EXECUTIONS);
    expect(buffer.pending[0]?.job.id).toBe(1);
  });

  it('re-queues the batch on a non-FK failure and counts nothing', async () => {
    const boom = jest.fn().mockRejectedValue(new Error('conn reset'));
    const { deps, buffer } = setup([1], boom);
    buffer.enqueue(job(1), 'Job_1', VALUES);

    await buffer.flush(deps);

    expect(buffer.pending).toHaveLength(1);
    expect(deps.onInserted).not.toHaveBeenCalled();
  });
});

describe('ExecutionBuffer.flush — failed-flush re-queue cap', () => {
  it('re-applies the cap after re-queueing, dropping the oldest with a warn', async () => {
    const at = (i: number) => ({ ...VALUES, durationMs: i });
    const { deps, buffer } = setup([1]);
    const values = jest.fn().mockImplementation(() => {
      // Rows that finish while the failed INSERT is in flight.
      for (let i = 0; i < 5; i++) buffer.enqueue(job(1), 'Job_1', at(5000 + i));
      return Promise.reject(new Error('conn reset'));
    });
    (deps.db as unknown as { insert: jest.Mock }).insert.mockReturnValue({
      values,
    });
    for (let i = 0; i < MAX_QUEUED_EXECUTIONS; i++) {
      buffer.enqueue(job(1), 'Job_1', at(i));
    }

    await buffer.flush(deps);

    expect(buffer.pending).toHaveLength(MAX_QUEUED_EXECUTIONS);
    expect(buffer.pending[0]?.values.durationMs).toBe(5); // 0..4 dropped
    expect(buffer.pending.at(-1)?.values.durationMs).toBe(5004);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('dropped the 5 oldest'),
    );
  });
});

describe('ExecutionBuffer.flush — missing parent (ROK-1328 guarantee)', () => {
  it('rebinds rows of a re-created job to its fresh id, re-resolving once', async () => {
    const { values, deps, buffer } = setup([2]);
    (deps.reresolve as jest.Mock).mockResolvedValue(job(9, 'Job_1'));
    buffer.enqueue(job(1), 'Job_1', VALUES);
    buffer.enqueue(job(1), 'Job_1', VALUES);
    buffer.enqueue(job(2), 'Job_2', VALUES);

    const rebinds = await buffer.flush(deps);

    expect(rebinds).toEqual(new Map([[1, 9]]));
    expect(deps.reresolve).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith([
      { cronJobId: 9, ...VALUES },
      { cronJobId: 9, ...VALUES },
      { cronJobId: 2, ...VALUES },
    ]);
    expect(deps.onInserted).toHaveBeenCalledWith(9, 2);
  });

  it('drops only the rows of a deleted job; the rest still land in one INSERT', async () => {
    const { values, deps, buffer } = setup([2]);
    buffer.enqueue(job(1), 'Job_1', VALUES);
    buffer.enqueue(job(2), 'Job_2', VALUES);

    await buffer.flush(deps);

    expect(values).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith([{ cronJobId: 2, ...VALUES }]);
    expect(deps.onInserted).toHaveBeenCalledTimes(1);
    expect(deps.onInserted).toHaveBeenCalledWith(2, 1);
  });

  it('falls back to per-row inserts when a parent vanishes after the pre-check', async () => {
    const values = jest
      .fn()
      .mockRejectedValueOnce(fkError()) // the batch
      .mockRejectedValueOnce(fkError()) // row 1: parent gone
      .mockResolvedValueOnce(undefined); // row 2
    const { db, deps, buffer } = setup([1, 2], values);
    buffer.enqueue(job(1), 'Job_1', VALUES);
    buffer.enqueue(job(2), 'Job_2', VALUES);

    await expect(buffer.flush(deps)).resolves.toEqual(new Map());

    expect(db.insert).toHaveBeenCalledTimes(3);
    expect(deps.reresolve).toHaveBeenCalledWith('Job_1');
    expect(deps.onInserted).toHaveBeenCalledTimes(1);
    expect(deps.onInserted).toHaveBeenCalledWith(2, 1);
    expect(buffer.pending).toHaveLength(0);
  });
});
