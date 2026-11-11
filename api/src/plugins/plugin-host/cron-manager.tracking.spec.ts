/**
 * ROK-2166: a SCHEDULED plugin tick goes through the shared job tracker
 * (CronJobService.executeWithTracking), so the admin Jobs page's Pause stops
 * it and every run leaves an execution row — not only "Run now".
 *
 * Uses the real CronManagerService + the real CronJobService on the shared
 * drizzle mock; the tick is fired with the cron library's own `fireOnTick`.
 */
import { CronJob } from 'cron';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import * as schema from '../../drizzle/schema';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { CronManagerService } from './cron-manager.service';
import type { CronRegistrar } from './extension-points';

const JOB_NAME = 'wow:forever-quest-import';

function jobRow(paused: boolean): typeof schema.cronJobs.$inferSelect {
  return {
    id: 41,
    name: JOB_NAME,
    cronExpression: '0 30 6 * * 3',
    source: 'plugin',
    pluginSlug: 'wow',
    description: null,
    category: 'Plugins',
    paused,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

interface Harness {
  db: MockDb;
  tracker: CronJobService;
  cronJob: CronJob;
}

/** Register one plugin job through the real manager; capture its CronJob. */
function setup(handler: () => Promise<void>): Harness {
  const db = createDrizzleMock();
  const jobs = new Map<string, CronJob>();
  const registry = {
    getCronJob: (name: string) => {
      const job = jobs.get(name);
      if (!job) throw new Error(`no job ${name}`);
      return job;
    },
    addCronJob: (name: string, job: CronJob) => void jobs.set(name, job),
  };
  const adapter: CronRegistrar = {
    getCronJobs: () => [
      { name: 'forever-quest-import', cronExpression: '0 30 6 * * 3', handler },
    ],
  };
  const plugins = { getAdapter: () => adapter };
  const tracker = new CronJobService(db as never, registry as never);
  const manager = new CronManagerService(
    registry as never,
    plugins as never,
    tracker,
  );
  manager.handlePluginActivated({ slug: 'wow' });
  const cronJob = jobs.get(JOB_NAME);
  if (!cronJob) throw new Error('plugin job was not registered');
  void cronJob.stop();
  return { db, tracker, cronJob };
}

/** Fire one scheduled tick and let the tracked run settle. */
async function tick(cronJob: CronJob): Promise<void> {
  await cronJob.fireOnTick();
  await new Promise((resolve) => setImmediate(resolve));
}

/** The `status` of an inserted values object, or undefined. */
function statusOf(values: unknown): unknown {
  if (typeof values !== 'object' || values === null) return undefined;
  return 'status' in values ? values.status : undefined;
}

/** Statuses of the execution rows the tick inserted (insert → values). */
function executionStatuses(db: MockDb): unknown[] {
  const statuses: unknown[] = [];
  db.insert.mock.calls.forEach((call: unknown[], i: number) => {
    if (call[0] !== schema.cronJobExecutions) return;
    statuses.push(statusOf(db.values.mock.calls[i]?.[0]));
  });
  return statuses;
}

describe('CronManagerService scheduled plugin ticks (ROK-2166)', () => {
  let harness: Harness | null = null;
  afterEach(async () => {
    await harness?.tracker.onModuleDestroy();
    harness = null;
  });

  it('a paused plugin job: the tick does not call the handler and records a skip', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    harness = setup(handler);
    harness.db.limit.mockResolvedValueOnce([jobRow(true)]);

    await tick(harness.cronJob);

    expect(handler).not.toHaveBeenCalled();
    expect(executionStatuses(harness.db)).toEqual(['skipped']);
  });

  it('an unpaused plugin job: the tick calls the handler once and writes an execution row', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    harness = setup(handler);
    harness.db.limit.mockResolvedValueOnce([jobRow(false)]);

    await tick(harness.cronJob);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(executionStatuses(harness.db)).toEqual(['completed']);
  });

  it('a throwing handler is recorded as failed and the tick does not reject', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('bnet 503'));
    harness = setup(handler);
    harness.db.limit.mockResolvedValueOnce([jobRow(false)]);

    await expect(tick(harness.cronJob)).resolves.toBeUndefined();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(executionStatuses(harness.db)).toEqual(['failed']);
  });
});
