/**
 * Retired plugin cron rows are hidden, not deleted (ROK-2163).
 *
 * A plugin that stops registering a job leaves its cron_jobs row behind. The
 * admin list must not show it and its admin endpoints must 404 instead of
 * recording a 'skipped' run. Core rows, rows of un-synced plugins and rows of
 * a registrar that threw keep today's behaviour.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { CronJobService } from './cron-job.service';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { nonEmpty } from '../common/testing/narrow';

type Registrar = {
  getCronJobs(): {
    name: string;
    cronExpression: string;
    handler: () => Promise<void>;
  }[];
};

const HOURLY = '0 * * * *';
const liveRegistrar: Registrar = {
  getCronJobs: () => [
    { name: 'live', cronExpression: HOURLY, handler: () => Promise.resolve() },
  ],
};
const throwingRegistrar: Registrar = {
  getCronJobs: () => {
    throw new Error('registrar exploded');
  },
};

async function insertJob(
  testApp: TestApp,
  name: string,
  pluginSlug: string | null,
): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.cronJobs)
      .values({
        name,
        source: pluginSlug ? 'plugin' : 'core',
        pluginSlug,
        cronExpression: HOURLY,
        paused: false,
      })
      .returning(),
    'cron job',
  );
  return row.id;
}

async function listedNames(testApp: TestApp, token: string): Promise<string[]> {
  const res = await testApp.request
    .get('/admin/cron-jobs')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return (res.body as Array<{ name: string }>).map((j) => j.name);
}

function pauseJob(testApp: TestApp, token: string, id: number) {
  return testApp.request
    .patch(`/admin/cron-jobs/${id}/pause`)
    .set('Authorization', `Bearer ${token}`);
}

function describeRetiredPluginJobs() {
  let testApp: TestApp;
  let adminToken: string;
  let spy: jest.SpyInstance | undefined;

  /** Run a full sync with only the given plugin registrars active. */
  async function syncWith(registrars: Map<string, Registrar>): Promise<void> {
    const registry = testApp.app.get(PluginRegistryService, { strict: false });
    spy?.mockRestore();
    spy = jest
      .spyOn(registry, 'getAdaptersForExtensionPoint')
      .mockReturnValue(registrars);
    await testApp.app.get(CronJobService).syncJobs();
  }

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterEach(async () => {
    // Leave the shared service with no plugin synced, so nothing stays hidden.
    await syncWith(new Map());
    spy?.mockRestore();
    spy = undefined;
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  it('hides a stale plugin row and 404s its run, pause and schedule', async () => {
    const staleId = await insertJob(testApp, 'fakeplug:stale', 'fakeplug');
    await syncWith(new Map([['fakeplug', liveRegistrar]]));

    expect(await listedNames(testApp, adminToken)).not.toContain(
      'fakeplug:stale',
    );
    const run = await testApp.request
      .post(`/admin/cron-jobs/${staleId}/run`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(run.status).toBe(404);
    expect((await pauseJob(testApp, adminToken, staleId)).status).toBe(404);
    const schedule = await testApp.request
      .patch(`/admin/cron-jobs/${staleId}/schedule`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cronExpression: '*/10 * * * *' });
    expect(schedule.status).toBe(404);

    // Hidden, never deleted, and no 'skipped' run was recorded.
    const executions = await testApp.db
      .select()
      .from(schema.cronJobExecutions)
      .where(eq(schema.cronJobExecutions.cronJobId, staleId));
    expect(executions).toEqual([]);
    const [row] = await testApp.db
      .select()
      .from(schema.cronJobs)
      .where(eq(schema.cronJobs.id, staleId));
    expect(row?.paused).toBe(false);
  });

  it('still lists the live plugin job and a core job', async () => {
    const coreId = await insertJob(testApp, 'test:core-job', null);
    await syncWith(new Map([['fakeplug', liveRegistrar]]));

    const names = await listedNames(testApp, adminToken);
    expect(names).toContain('fakeplug:live');
    expect(names).toContain('test:core-job');
    expect((await pauseJob(testApp, adminToken, coreId)).status).toBe(200);
  });

  it('leaves rows of an un-synced plugin and of a throwing registrar alone', async () => {
    const ghostId = await insertJob(testApp, 'ghostplug:old', 'ghostplug');
    await insertJob(testApp, 'boomplug:old', 'boomplug');
    await syncWith(
      new Map([
        ['fakeplug', liveRegistrar],
        ['boomplug', throwingRegistrar],
      ]),
    );

    const names = await listedNames(testApp, adminToken);
    expect(names).toContain('ghostplug:old');
    expect(names).toContain('boomplug:old');
    expect((await pauseJob(testApp, adminToken, ghostId)).status).toBe(200);
  });
}

describe('Cron-Job retired plugin rows (integration)', () =>
  describeRetiredPluginJobs());
