/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/**
 * Cron-Job Integration Tests (ROK-526)
 *
 * Verifies cron job execution tracking (completed/failed/skipped),
 * execution history pruning, pause/resume, and schedule updates
 * against a real PostgreSQL database.
 *
 * Uses service-level calls for executeWithTracking (no HTTP controller)
 * and HTTP endpoints for admin CRUD (pause/resume/schedule).
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { eq, desc } from 'drizzle-orm';
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
      cronExpression: '0 * * * *', // every hour
      paused: false,
      ...overrides,
    })
    .returning();
  return job.id;
}

describe('Cron-Job (integration)', () => {
  let testApp: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  // ===================================================================
  // Execution Tracking (service-level)
  // ===================================================================

  describe('executeWithTracking', () => {
    it('should record completed execution with timing', async () => {
      const jobId = await insertTestJob(testApp, 'test:completed-job');

      const cronJobService = testApp.app.get(CronJobService);

      // Execute a successful handler
      await cronJobService.executeWithTracking(
        'test:completed-job',
        async () => {
          // Simulate some work
          await new Promise((resolve) => setTimeout(resolve, 10));
        },
      );

      // Check execution was recorded
      const executions = await testApp.db
        .select()
        .from(schema.cronJobExecutions)
        .where(eq(schema.cronJobExecutions.cronJobId, jobId))
        .orderBy(desc(schema.cronJobExecutions.startedAt));

      expect(executions.length).toBe(1);
      expect(executions[0].status).toBe('completed');
      expect(executions[0].durationMs).toBeGreaterThanOrEqual(0);
      expect(executions[0].finishedAt).toBeDefined();
      expect(executions[0].error).toBeNull();

      // Check that lastRunAt was updated on the job
      const [updatedJob] = await testApp.db
        .select()
        .from(schema.cronJobs)
        .where(eq(schema.cronJobs.id, jobId))
        .limit(1);

      expect(updatedJob.lastRunAt).toBeDefined();
    });

    it('should record failed execution with error message', async () => {
      const jobId = await insertTestJob(testApp, 'test:failed-job');

      const cronJobService = testApp.app.get(CronJobService);

      // Execute a handler that throws
      await cronJobService.executeWithTracking('test:failed-job', () =>
        Promise.reject(new Error('Simulated cron failure')),
      );

      // Check execution was recorded as failed
      const executions = await testApp.db
        .select()
        .from(schema.cronJobExecutions)
        .where(eq(schema.cronJobExecutions.cronJobId, jobId));

      expect(executions.length).toBe(1);
      expect(executions[0].status).toBe('failed');
      expect(executions[0].error).toBe('Simulated cron failure');
      expect(executions[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should log skipped execution when job is paused', async () => {
      const jobId = await insertTestJob(testApp, 'test:paused-job', {
        paused: true,
      });

      const cronJobService = testApp.app.get(CronJobService);

      let handlerRan = false;
      await cronJobService.executeWithTracking('test:paused-job', () => {
        handlerRan = true;
        return Promise.resolve();
      });

      // Handler should NOT have run
      expect(handlerRan).toBe(false);

      // Execution should be recorded as skipped
      const executions = await testApp.db
        .select()
        .from(schema.cronJobExecutions)
        .where(eq(schema.cronJobExecutions.cronJobId, jobId));

      expect(executions.length).toBe(1);
      expect(executions[0].status).toBe('skipped');
      expect(executions[0].durationMs).toBe(0);
    });

    it('should run handler directly when job is not yet synced to DB', async () => {
      const cronJobService = testApp.app.get(CronJobService);

      // Use a name that does NOT exist in the DB
      let handlerRan = false;
      await cronJobService.executeWithTracking('non-existent-job-name', () => {
        handlerRan = true;
        return Promise.resolve();
      });

      // Handler should still run (fallback behavior)
      expect(handlerRan).toBe(true);
    });
  });

  // ===================================================================
  // Execution Pruning
  // ===================================================================

  describe('execution pruning', () => {
    it('should keep last 50 executions and delete older ones', async () => {
      const jobId = await insertTestJob(testApp, 'test:prunable-job');

      // Insert 55 execution records directly
      const execValues = [];
      for (let i = 0; i < 55; i++) {
        execValues.push({
          cronJobId: jobId,
          status: 'completed',
          startedAt: new Date(Date.now() - (55 - i) * 60_000),
          finishedAt: new Date(Date.now() - (55 - i) * 60_000 + 1000),
          durationMs: 1000,
        });
      }
      await testApp.db.insert(schema.cronJobExecutions).values(execValues);

      // Trigger a new execution (which invokes pruning in finally block)
      const cronJobService = testApp.app.get(CronJobService);

      await cronJobService.executeWithTracking(
        'test:prunable-job',
        async () => {
          // no-op
        },
      );

      // Wait briefly for the async prune to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Count remaining executions (should be ~50)
      const remaining = await testApp.db
        .select()
        .from(schema.cronJobExecutions)
        .where(eq(schema.cronJobExecutions.cronJobId, jobId));

      // 55 existing + 1 new = 56, pruning keeps 50
      expect(remaining.length).toBeLessThanOrEqual(51);
      expect(remaining.length).toBeGreaterThanOrEqual(50);
    });
  });

  // ===================================================================
  // Admin API — Pause/Resume (HTTP)
  // ===================================================================

  describe('pause and resume', () => {
    it('should pause a cron job via admin API', async () => {
      const jobId = await insertTestJob(testApp, 'test:pausable');

      const pauseRes = await testApp.request
        .patch(`/admin/cron-jobs/${jobId}/pause`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(pauseRes.status).toBe(200);
      expect(pauseRes.body.paused).toBe(true);

      // Verify in DB
      const [job] = await testApp.db
        .select()
        .from(schema.cronJobs)
        .where(eq(schema.cronJobs.id, jobId))
        .limit(1);

      expect(job.paused).toBe(true);
    });

    it('should resume a paused cron job via admin API', async () => {
      const jobId = await insertTestJob(testApp, 'test:resumable', {
        paused: true,
      });

      const resumeRes = await testApp.request
        .patch(`/admin/cron-jobs/${jobId}/resume`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(resumeRes.status).toBe(200);
      expect(resumeRes.body.paused).toBe(false);
    });
  });

  // ===================================================================
  // Admin API — Schedule Update (HTTP)
  // ===================================================================

  describe('schedule update', () => {
    it('should update cron expression and persist', async () => {
      const jobId = await insertTestJob(testApp, 'test:reschedulable');

      const updateRes = await testApp.request
        .patch(`/admin/cron-jobs/${jobId}/schedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cronExpression: '*/5 * * * *' }); // every 5 minutes

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.cronExpression).toBe('*/5 * * * *');

      // Verify in DB
      const [job] = await testApp.db
        .select()
        .from(schema.cronJobs)
        .where(eq(schema.cronJobs.id, jobId))
        .limit(1);

      expect(job.cronExpression).toBe('*/5 * * * *');
    });

    it('should reject invalid cron expression', async () => {
      const jobId = await insertTestJob(testApp, 'test:invalid-cron');

      const updateRes = await testApp.request
        .patch(`/admin/cron-jobs/${jobId}/schedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cronExpression: 'not-a-cron' });

      expect(updateRes.status).toBe(400);
    });
  });

  // ===================================================================
  // Admin API — List and Execution History (HTTP)
  // ===================================================================

  describe('list and history', () => {
    it('should list all registered cron jobs', async () => {
      await insertTestJob(testApp, 'test:listable-1');
      await insertTestJob(testApp, 'test:listable-2');

      const listRes = await testApp.request
        .get('/admin/cron-jobs')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.length).toBeGreaterThanOrEqual(2);

      const names = listRes.body.map((j: any) => j.name);
      expect(names).toContain('test:listable-1');
      expect(names).toContain('test:listable-2');
    });

    it('should return execution history for a job', async () => {
      const jobId = await insertTestJob(testApp, 'test:history-job');

      // Insert some executions
      await testApp.db.insert(schema.cronJobExecutions).values([
        {
          cronJobId: jobId,
          status: 'completed',
          startedAt: new Date(Date.now() - 120_000),
          finishedAt: new Date(Date.now() - 119_000),
          durationMs: 1000,
        },
        {
          cronJobId: jobId,
          status: 'failed',
          startedAt: new Date(Date.now() - 60_000),
          finishedAt: new Date(Date.now() - 59_000),
          durationMs: 1000,
          error: 'Test error',
        },
      ]);

      const historyRes = await testApp.request
        .get(`/admin/cron-jobs/${jobId}/executions`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(historyRes.status).toBe(200);
      expect(historyRes.body.length).toBe(2);

      // Most recent first
      expect(historyRes.body[0].status).toBe('failed');
      expect(historyRes.body[0].error).toBe('Test error');
      expect(historyRes.body[1].status).toBe('completed');
    });
  });

  // ===================================================================
  // Auth Guards
  // ===================================================================

  describe('auth guards', () => {
    it('should require admin role for cron-job endpoints', async () => {
      const res = await testApp.request.get('/admin/cron-jobs');
      expect(res.status).toBe(401);
    });

    it('should reject non-admin users', async () => {
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash('TestPassword123!', 4);

      const [user] = await testApp.db
        .insert(schema.users)
        .values({
          discordId: 'local:member@test.local',
          username: 'member',
          role: 'member',
        })
        .returning();

      await testApp.db.insert(schema.localCredentials).values({
        email: 'member@test.local',
        passwordHash,
        userId: user.id,
      });

      const loginRes = await testApp.request
        .post('/auth/local')
        .send({ email: 'member@test.local', password: 'TestPassword123!' });

      const memberToken = loginRes.body.access_token as string;

      const res = await testApp.request
        .get('/admin/cron-jobs')
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(403);
    });
  });
});
