/** ROK-1700 — the weekly Co-Optimus cron is a no-op on a cloud instance. */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import type * as schema from '../drizzle/schema';
import {
  CooptimusSyncService,
  type SyncSummary,
} from './cooptimus-sync.service';
import type { CooptimusService } from './cooptimus.service';
import type { CronJobService } from '../cron-jobs/cron-job.service';

function build() {
  const executeWithTracking = jest.fn(
    async (_name: string, fn: () => Promise<unknown>) => {
      await fn();
    },
  );
  const isConfigured = jest.fn().mockResolvedValue(true);
  const service = new CooptimusSyncService(
    {} as PostgresJsDatabase<typeof schema>,
    {} as Redis,
    { isConfigured } as unknown as CooptimusService,
    { executeWithTracking } as unknown as CronJobService,
  );
  const summary: SyncSummary = {
    scanned: 0,
    synced: 0,
    noEntry: 0,
    review: 0,
    failed: 0,
    aborted: false,
  };
  const runSync = jest.spyOn(service, 'runSync').mockResolvedValue(summary);
  return { service, executeWithTracking, runSync };
}

describe('ROK-1700 CooptimusSyncService.weeklySync under RL_FLAVOUR', () => {
  afterEach(() => delete process.env.RL_FLAVOUR);

  it('cloud: returns early — never tracked, never synced, even with a UA configured', async () => {
    process.env.RL_FLAVOUR = 'cloud';
    const { service, executeWithTracking, runSync } = build();
    await service.weeklySync();
    expect(executeWithTracking).not.toHaveBeenCalled();
    expect(runSync).not.toHaveBeenCalled();
  });

  it('nas: runs the sync when configured (unchanged)', async () => {
    process.env.RL_FLAVOUR = 'nas';
    const { service, executeWithTracking, runSync } = build();
    await service.weeklySync();
    expect(executeWithTracking).toHaveBeenCalledTimes(1);
    expect(runSync).toHaveBeenCalledTimes(1);
  });
});
