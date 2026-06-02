/**
 * Cron-Job FK-Recovery Integration Tests (ROK-1328)
 *
 * Verifies that CronJobService self-heals a stale cached `job.id` after the
 * underlying `cron_jobs` row is deleted out from under the in-memory cache
 * (fleet clone/reset, backup restore, manual delete). Before the fix, every
 * subsequent tick re-inserted `cron_job_executions` with the dead FK → 23503
 * → re-thrown on the catch side → ~2 Sentry events/min until a process
 * restart. After the fix: the insert re-resolves the job by name, retries once
 * against the fresh id (re-inserted same name) or skips the row when the job
 * is genuinely gone — never re-throws.
 *
 * Runs against a real PostgreSQL DB so the FK constraint actually fires.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { CronJobService } from './cron-job.service';

/** Insert a test cron job directly into DB and return its ID. */
async function insertTestJob(
  testApp: TestApp,
  name: string,
  overrides: Partial<typeof schema.cronJobs.$inferInsert> = {},
): Promise<number> {
  const [job] = await testApp.db
    .insert(schema.cronJobs)
    .values({
      name,
      source: 'core',
      cronExpression: '0 * * * *',
      paused: false,
      ...overrides,
    })
    .returning();
  return job.id;
}

/** Count execution rows for a given cron_job_id. */
async function countExecutions(
  testApp: TestApp,
  cronJobId: number,
): Promise<number> {
  const rows = await testApp.db
    .select()
    .from(schema.cronJobExecutions)
    .where(eq(schema.cronJobExecutions.cronJobId, cronJobId));
  return rows.length;
}

function describeFkRecovery() {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
    await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('skips the execution row (no throw) when the cached job was deleted', async () => {
    const staleId = await insertTestJob(testApp, 'test:fk-gone');
    const svc = testApp.app.get(CronJobService);

    // First run caches the row.
    await svc.executeWithTracking('test:fk-gone', () => Promise.resolve());
    expect(await countExecutions(testApp, staleId)).toBe(1);

    // Delete the row out from under the cache (cache still holds dead id).
    await testApp.db
      .delete(schema.cronJobs)
      .where(eq(schema.cronJobs.id, staleId));

    // Second run: cache hit → dead FK on insert → re-resolve → null → skip.
    let handlerRan = false;
    await expect(
      svc.executeWithTracking('test:fk-gone', () => {
        handlerRan = true;
        return Promise.resolve();
      }),
    ).resolves.toBeUndefined();

    expect(handlerRan).toBe(true);
    // No new row inserted against the dead id (the original was cascade-deleted
    // with the job, so the count is 0 either way — assert nothing was inserted
    // against a stale id, i.e. no error bubbled and the table is clean).
    expect(await countExecutions(testApp, staleId)).toBe(0);
  });

  it('retries the insert against the fresh id when the row is re-created', async () => {
    const staleId = await insertTestJob(testApp, 'test:fk-recreate');
    const svc = testApp.app.get(CronJobService);

    // First run caches the row (with staleId).
    await svc.executeWithTracking('test:fk-recreate', () => Promise.resolve());

    // Delete then re-insert the SAME name — gets a NEW id.
    await testApp.db
      .delete(schema.cronJobs)
      .where(eq(schema.cronJobs.id, staleId));
    const freshId = await insertTestJob(testApp, 'test:fk-recreate');
    expect(freshId).not.toBe(staleId);

    // Second run: cache holds staleId → FK 23503 → re-resolve → retry vs freshId.
    await expect(
      svc.executeWithTracking('test:fk-recreate', () => Promise.resolve()),
    ).resolves.toBeUndefined();

    // The execution row landed against the FRESH id.
    expect(await countExecutions(testApp, freshId)).toBe(1);
    expect(await countExecutions(testApp, staleId)).toBe(0);
  });

  it('does not bubble when the FAILED-path record hits a stale FK (AC-4)', async () => {
    const staleId = await insertTestJob(testApp, 'test:fk-failed-path');
    const svc = testApp.app.get(CronJobService);

    // Cache the row.
    await svc.executeWithTracking('test:fk-failed-path', () =>
      Promise.resolve(),
    );
    await testApp.db
      .delete(schema.cronJobs)
      .where(eq(schema.cronJobs.id, staleId));

    // Handler throws AND the failure-record insert hits the dead FK. The whole
    // call must still resolve (never re-throw the FK).
    await expect(
      svc.executeWithTracking('test:fk-failed-path', () =>
        Promise.reject(new Error('handler boom')),
      ),
    ).resolves.toBeUndefined();

    expect(await countExecutions(testApp, staleId)).toBe(0);
  });

  it('refreshJobCache picks up an externally-added row without restart (AC-6)', async () => {
    const svc = testApp.app.get(CronJobService);

    // Externally insert a brand-new job AFTER the cache was last populated.
    const newId = await insertTestJob(testApp, 'test:fk-periodic-refresh');

    // Periodic refresh (the flush interval calls this) re-pulls the cache.
    await svc.refreshJobCache();

    // Now executeWithTracking resolves it and tracks normally.
    await svc.executeWithTracking('test:fk-periodic-refresh', () =>
      Promise.resolve(),
    );
    expect(await countExecutions(testApp, newId)).toBe(1);
  });
}
describe('Cron-Job FK recovery (integration, ROK-1328)', () =>
  describeFkRecovery());
