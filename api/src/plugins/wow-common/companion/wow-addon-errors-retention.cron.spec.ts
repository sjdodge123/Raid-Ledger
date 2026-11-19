/**
 * ROK-2099 D7 — the addon-error retention tick: 90 days after last seen,
 * gated on `blizzard` being active, tracked under its declared job name.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CronJobService } from '../../../cron-jobs/cron-job.service';
import type * as schema from '../../../drizzle/schema';
import type { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import {
  addonErrorsRetentionCutoff,
  WOW_ADDON_ERRORS_RETENTION_DAYS,
  WOW_ADDON_ERRORS_RETENTION_JOB,
  WowAddonErrorsRetentionCron,
} from './wow-addon-errors-retention.cron';

function build(active: boolean, deleted: number) {
  const returning = jest
    .fn()
    .mockResolvedValue(Array.from({ length: deleted }, (_, i) => ({ id: i })));
  const where = jest.fn().mockReturnValue({ returning });
  const db = { delete: jest.fn().mockReturnValue({ where }) };
  const cronJobService = {
    executeWithTracking: jest.fn(
      (_name: string, fn: () => Promise<unknown>): Promise<unknown> => fn(),
    ),
  };
  const registry = { isActive: jest.fn().mockReturnValue(active) };
  const cron = new WowAddonErrorsRetentionCron(
    db as unknown as PostgresJsDatabase<typeof schema>,
    cronJobService as unknown as CronJobService,
    registry as unknown as PluginRegistryService,
  );
  return { cron, db, cronJobService, registry };
}

describe('addonErrorsRetentionCutoff', () => {
  it('is exactly 90 days before now (ruling 2026-11-19)', () => {
    expect(WOW_ADDON_ERRORS_RETENTION_DAYS).toBe(90);
    expect(
      addonErrorsRetentionCutoff(new Date('2026-11-19T05:45:00Z')).toISOString(),
    ).toBe('2026-08-21T05:45:00.000Z');
  });
});

describe('WowAddonErrorsRetentionCron', () => {
  it('does nothing (no tracked run, no delete) while blizzard is inactive', async () => {
    const { cron, db, cronJobService, registry } = build(false, 3);
    await cron.prune();
    expect(registry.isActive).toHaveBeenCalledWith('blizzard');
    expect(cronJobService.executeWithTracking).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('runs tracked under WowAddonErrorsRetention_prune while blizzard is active', async () => {
    const { cron, db, cronJobService } = build(true, 2);
    await cron.prune();
    expect(WOW_ADDON_ERRORS_RETENTION_JOB).toBe('WowAddonErrorsRetention_prune');
    expect(cronJobService.executeWithTracking).toHaveBeenCalledWith(
      WOW_ADDON_ERRORS_RETENTION_JOB,
      expect.any(Function),
    );
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it('runOnce returns the number of rows deleted', async () => {
    await expect(build(true, 4).cron.runOnce()).resolves.toBe(4);
    await expect(build(true, 0).cron.runOnce()).resolves.toBe(0);
  });
});
