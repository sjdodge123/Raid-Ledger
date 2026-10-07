/**
 * Batched execution-history writes (ROK-1380 part B), against a real DB.
 *
 * Completed/degraded runs of a high-frequency job queue their
 * cron_job_executions row; each flush writes the queue in ONE multi-row
 * INSERT. A queued row whose cron_jobs parent vanished must not poison the
 * batch (the ROK-1328 FK self-heal guarantee): it is rebound to a re-created
 * job of the same name, or dropped when the job is gone.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { asc, eq } from 'drizzle-orm';
import { CronJobService } from './cron-job.service';
import { computeNextRun } from './cron-job.helpers';
import type { CronRunBookkeeping } from './cron-job.bookkeeping';
import { at, nonEmpty } from '../common/testing/narrow';

async function insertJob(
  testApp: TestApp,
  name: string,
  cronExpression = '*/5 * * * *',
): Promise<number> {
  const [job] = nonEmpty(
    await testApp.db
      .insert(schema.cronJobs)
      .values({ name, source: 'core', cronExpression })
      .returning(),
    'job',
  );
  return job.id;
}

function readExecutions(testApp: TestApp, jobId: number) {
  return testApp.db
    .select()
    .from(schema.cronJobExecutions)
    .where(eq(schema.cronJobExecutions.cronJobId, jobId))
    .orderBy(asc(schema.cronJobExecutions.id));
}

async function readJob(testApp: TestApp, jobId: number) {
  const [job] = await testApp.db
    .select()
    .from(schema.cronJobs)
    .where(eq(schema.cronJobs.id, jobId));
  return job;
}

async function deleteJob(testApp: TestApp, jobId: number): Promise<void> {
  await testApp.db.delete(schema.cronJobs).where(eq(schema.cronJobs.id, jobId));
}

const ok = () => Promise.resolve();
const degraded = () => Promise.resolve({ degraded: true as const });

function describeBatching() {
  let testApp: TestApp;
  let svc: CronJobService;

  beforeAll(async () => {
    testApp = await getTestApp();
    svc = testApp.app.get(CronJobService);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await svc.flushLastRunUpdates(); // never leak a queue into the next test
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('N runs write nothing until the flush, then land in ONE INSERT', async () => {
    const jobId = await insertJob(testApp, 'test:batch-three');
    await svc.executeWithTracking('test:batch-three', ok);
    await svc.executeWithTracking('test:batch-three', degraded);
    await svc.executeWithTracking('test:batch-three', ok);
    expect(await readExecutions(testApp, jobId)).toHaveLength(0);

    const insertSpy = jest.spyOn(testApp.db, 'insert');
    await svc.flushLastRunUpdates();

    const execInserts = insertSpy.mock.calls.filter(
      ([table]) => table === schema.cronJobExecutions,
    );
    expect(execInserts).toHaveLength(1);
    const rows = await readExecutions(testApp, jobId);
    expect(rows.map((r) => r.status)).toEqual([
      'completed',
      'degraded',
      'completed',
    ]);
    for (const r of rows) {
      expect(r.finishedAt!.getTime()).toBe(
        r.startedAt.getTime() + r.durationMs!,
      );
      expect(r.error).toBeNull();
    }
    const [job] = await testApp.db
      .select()
      .from(schema.cronJobs)
      .where(eq(schema.cronJobs.id, jobId));
    expect(job?.lastRunAt?.getTime()).toBe(at(rows, 2).finishedAt!.getTime());
  });

  it('drops a deleted job’s queued rows without losing the live job’s rows', async () => {
    const goneId = await insertJob(testApp, 'test:batch-gone');
    const liveId = await insertJob(testApp, 'test:batch-live');
    await svc.executeWithTracking('test:batch-gone', ok);
    await svc.executeWithTracking('test:batch-live', ok);
    await deleteJob(testApp, goneId); // cached id is now a dead FK

    await expect(svc.flushLastRunUpdates()).resolves.toBeUndefined();

    expect(await readExecutions(testApp, goneId)).toHaveLength(0);
    const live = await readExecutions(testApp, liveId);
    expect(live.map((r) => r.status)).toEqual(['completed']);
  });

  it('rebinds queued rows to a re-created job of the same name', async () => {
    const staleId = await insertJob(testApp, 'test:batch-recreate');
    await svc.executeWithTracking('test:batch-recreate', ok);
    await svc.executeWithTracking('test:batch-recreate', ok);
    await deleteJob(testApp, staleId);
    const freshId = await insertJob(testApp, 'test:batch-recreate');

    await expect(svc.flushLastRunUpdates()).resolves.toBeUndefined();

    expect(await readExecutions(testApp, freshId)).toHaveLength(2);
    expect(await readExecutions(testApp, staleId)).toHaveLength(0);
  });

  it('moves the queued last_run_at to a re-created job with its rows', async () => {
    const staleId = await insertJob(testApp, 'test:batch-recreate-lastrun');
    await svc.executeWithTracking('test:batch-recreate-lastrun', ok);
    await deleteJob(testApp, staleId);
    const freshId = await insertJob(testApp, 'test:batch-recreate-lastrun');

    await svc.flushLastRunUpdates();

    const [row] = await readExecutions(testApp, freshId);
    const [fresh] = await testApp.db
      .select()
      .from(schema.cronJobs)
      .where(eq(schema.cronJobs.id, freshId));
    expect({ lastRunAt: fresh?.lastRunAt ?? null }).toEqual({
      lastRunAt: row?.finishedAt,
    });
  });

  it('keeps last_run_at back while a failed INSERT re-queues the row, then retries', async () => {
    const jobId = await insertJob(testApp, 'test:batch-insert-fails');
    await svc.executeWithTracking('test:batch-insert-fails', ok);
    const realInsert = testApp.db.insert.bind(testApp.db);
    const insertSpy = jest
      .spyOn(testApp.db, 'insert')
      .mockImplementation((table: unknown) => {
        if (table === schema.cronJobExecutions) {
          throw new Error('simulated transient outage'); // not an FK 23503
        }
        return realInsert(table as typeof schema.cronJobs);
      });

    await svc.flushLastRunUpdates();

    expect(await readExecutions(testApp, jobId)).toHaveLength(0);
    expect((await readJob(testApp, jobId))?.lastRunAt ?? null).toBeNull();

    insertSpy.mockRestore();
    await svc.flushLastRunUpdates();

    const [row] = await readExecutions(testApp, jobId);
    expect(row?.status).toBe('completed');
    expect((await readJob(testApp, jobId))?.lastRunAt?.toISOString()).toBe(
      row?.finishedAt?.toISOString(),
    );
  });

  it('derives a rebound last_run_at’s next_run_at from the FRESH schedule', async () => {
    const name = 'test:batch-recreate-reschedule';
    const staleId = await insertJob(testApp, name); // every 5 minutes
    await svc.executeWithTracking(name, ok);
    await deleteJob(testApp, staleId);
    const yearly = '0 0 1 1 *';
    const freshId = await insertJob(testApp, name, yearly);

    await svc.flushLastRunUpdates();

    const fresh = await readJob(testApp, freshId);
    expect(fresh?.nextRunAt?.toISOString()).toBe(
      computeNextRun(yearly)?.toISOString(),
    );
  });

  it('counts rows for pruning when the flush writes them, not when queued', async () => {
    const jobId = await insertJob(testApp, 'test:batch-prune');
    const old = Array.from({ length: 55 }, (_, i) => {
      const startedAt = new Date(Date.now() - (60 - i) * 60_000);
      return {
        cronJobId: jobId,
        status: 'completed',
        startedAt,
        finishedAt: startedAt,
        durationMs: 0,
      };
    });
    await testApp.db.insert(schema.cronJobExecutions).values(old);
    const book = (svc as unknown as { book: CronRunBookkeeping }).book;
    book.executionCounts.set(jobId, 49);

    await svc.executeWithTracking('test:batch-prune', ok);
    expect(book.executionCounts.get(jobId)).toBe(49);
    expect(await readExecutions(testApp, jobId)).toHaveLength(55);

    await svc.flushLastRunUpdates();

    expect(book.executionCounts.get(jobId)).toBe(0);
    // 56 rows; the prune keeps the newest 50 plus its cutoff row.
    expect(await readExecutions(testApp, jobId)).toHaveLength(51);
  });
}

describe('Cron-Job batched execution rows (integration, ROK-1380)', () =>
  describeBatching());
