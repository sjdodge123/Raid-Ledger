/**
 * ROK-1417 (plan B3b Tier 3) — Quick Play health canary integration test.
 *
 * Real PostgreSQL (getTestApp). Target `./services/quick-play-health.service`
 * does NOT exist yet — this suite is fails-by-construction (module absent) until
 * the dev creates the service AND provider-registers it in the discord-bot
 * module (so `testApp.app.get(QuickPlayHealthService)` resolves).
 *
 * Proves the end-to-end DB path the unit test can't: the cron body runs its real
 * metric SQL against seeded rows and lands a `cron_job_executions` row via
 * `CronJobService.executeWithTracking` —
 *   - HEALTHY: ≥1 ad-hoc event in the last 7 days ⇒ status='completed', error NULL.
 *   - FAILED: 0 ad-hoc events + ≥1 inert binding ⇒ status='failed', and the
 *     `error` column NAMES the inert channel id (the operator-facing detail).
 *
 * The inert binding is RAW-inserted: the B3 invariant guard blocks creating a
 * null-game monitor through the API, so we write it directly (that is by design
 * — the canary exists precisely to surface rows the guard can no longer create
 * but a restore / FK SET NULL still can).
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { QuickPlayHealthService } from './services/quick-play-health.service';

const JOB_NAME = 'QuickPlayHealthService_checkQuickPlayHealth';
const INERT_CHANNEL_ID = 'inert-voice-chan-int';

/** Ensure a stable cron_jobs row exists (cron_jobs survives truncate) and clear
 *  its execution history so each test asserts exactly one fresh row. */
async function ensureCleanJob(testApp: TestApp): Promise<number> {
  const [existing] = await testApp.db
    .select()
    .from(schema.cronJobs)
    .where(eq(schema.cronJobs.name, JOB_NAME))
    .limit(1);
  if (existing) {
    await testApp.db
      .delete(schema.cronJobExecutions)
      .where(eq(schema.cronJobExecutions.cronJobId, existing.id));
    return existing.id;
  }
  const [row] = await testApp.db
    .insert(schema.cronJobs)
    .values({
      name: JOB_NAME,
      source: 'core',
      cronExpression: '0 15 5 * * *',
      paused: false,
    })
    .returning();
  return row.id;
}

async function seedAdHocEvent(testApp: TestApp): Promise<void> {
  const start = new Date();
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  await testApp.db.insert(schema.events).values({
    title: 'Quick Play canary fixture',
    creatorId: testApp.seed.adminUser.id,
    duration: [start, end],
    isAdHoc: true,
    adHocStatus: 'completed',
    gameId: testApp.seed.game.id,
  });
}

async function seedInertBinding(testApp: TestApp): Promise<void> {
  await testApp.db.insert(schema.channelBindings).values({
    guildId: 'guild-int',
    channelId: INERT_CHANNEL_ID,
    channelType: 'voice',
    bindingPurpose: 'game-voice-monitor',
    gameId: null,
  });
}

async function latestExecution(testApp: TestApp, jobId: number) {
  const [row] = await testApp.db
    .select()
    .from(schema.cronJobExecutions)
    .where(eq(schema.cronJobExecutions.cronJobId, jobId))
    .orderBy(desc(schema.cronJobExecutions.startedAt))
    .limit(1);
  return row;
}

function describeQuickPlayHealth() {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('records a COMPLETED execution when Quick Play produced ad-hoc events in the last 7 days', async () => {
    const jobId = await ensureCleanJob(testApp);
    await seedAdHocEvent(testApp);
    await seedInertBinding(testApp); // present but does NOT trip the alarm

    const service = testApp.app.get(QuickPlayHealthService);
    await service.checkQuickPlayHealth();

    const exec = await latestExecution(testApp, jobId);
    expect(exec).toBeDefined();
    expect(exec.status).toBe('completed');
    expect(exec.error).toBeNull();
  });

  it('records a FAILED execution whose error names the inert channel when 0 ad-hoc events + an inert binding', async () => {
    const jobId = await ensureCleanJob(testApp);
    await seedInertBinding(testApp); // no ad-hoc event ⇒ 7-day count is zero

    const service = testApp.app.get(QuickPlayHealthService);
    await service.checkQuickPlayHealth();

    const exec = await latestExecution(testApp, jobId);
    expect(exec).toBeDefined();
    expect(exec.status).toBe('failed');
    expect(exec.error).toContain(INERT_CHANNEL_ID);
  });
}

describe('QuickPlayHealthService (integration)', () => describeQuickPlayHealth());
