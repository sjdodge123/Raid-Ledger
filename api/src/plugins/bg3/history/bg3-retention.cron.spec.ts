/**
 * ROK-1957 D-9 / §5.8 — the retention tick is gated on the `bg3` plugin
 * being active and prunes each candidate group against the 90-day cutoff.
 */
import type { CronJobService } from '../../../cron-jobs/cron-job.service';
import type { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import {
  BG3_PLUGIN_ID,
  BG3_RETENTION_JOB_NAME,
  BG3_SESSION_GAP_MS,
} from '../bg3.constants';
import { Bg3HistoryRetentionCron } from './bg3-retention.cron';
import { retentionCutoff } from './bg3-retention.helpers';
import type { Bg3RetentionRepository } from './bg3-retention.repository';

const GROUPS = [
  { userId: 7, campaignId: 3 },
  { userId: 7, campaignId: null },
];

/** The DB clock, deliberately apart from the app's `now` (review fix 10). */
const DB_NOW = new Date('2026-10-28T05:15:07Z');

function build(active: boolean) {
  const repo = {
    listGroups: jest.fn().mockResolvedValue(GROUPS),
    pruneGroup: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0),
    dbNow: jest.fn().mockResolvedValue(DB_NOW),
  };
  const cronJobService = {
    executeWithTracking: jest.fn(
      (_name: string, fn: () => Promise<unknown>): Promise<unknown> => fn(),
    ),
  };
  const registry = { isActive: jest.fn().mockReturnValue(active) };
  const cron = new Bg3HistoryRetentionCron(
    repo as unknown as Bg3RetentionRepository,
    cronJobService as unknown as CronJobService,
    registry as unknown as PluginRegistryService,
  );
  return { cron, repo, cronJobService, registry };
}

describe('Bg3HistoryRetentionCron', () => {
  it('does nothing (no tracked run, no query) while bg3 is inactive', async () => {
    const { cron, repo, cronJobService, registry } = build(false);
    await cron.prune();
    expect(registry.isActive).toHaveBeenCalledWith(BG3_PLUGIN_ID);
    expect(cronJobService.executeWithTracking).not.toHaveBeenCalled();
    expect(repo.listGroups).not.toHaveBeenCalled();
  });

  it('runs tracked under the declared job name while bg3 is active', async () => {
    const { cron, repo, cronJobService } = build(true);
    await cron.prune();
    expect(cronJobService.executeWithTracking).toHaveBeenCalledWith(
      BG3_RETENTION_JOB_NAME,
      expect.any(Function),
    );
    expect(repo.pruneGroup).toHaveBeenCalledTimes(2);
  });

  it('prunes every candidate group against the 90-day cutoff', async () => {
    const { cron, repo } = build(true);
    const now = new Date('2026-10-28T05:15:00Z');
    const cutoff = retentionCutoff(now);
    await expect(cron.runOnce(now)).resolves.toEqual({
      deleted: 2,
      failedGroups: 0,
    });
    expect(repo.listGroups).toHaveBeenCalledWith(cutoff, BG3_SESSION_GAP_MS);
    expect(repo.pruneGroup).toHaveBeenNthCalledWith(
      1,
      GROUPS[0],
      cutoff,
      DB_NOW,
      BG3_SESSION_GAP_MS,
    );
    expect(repo.pruneGroup).toHaveBeenNthCalledWith(
      2,
      GROUPS[1],
      cutoff,
      DB_NOW,
      BG3_SESSION_GAP_MS,
    );
  });

  it('logs a throwing group, prunes the rest, and reports the run degraded', async () => {
    const { cron, repo, cronJobService } = build(true);
    repo.pruneGroup.mockReset();
    repo.pruneGroup
      .mockRejectedValueOnce(new Error('deadlock detected'))
      .mockResolvedValueOnce(3);
    await expect(cron.runOnce()).resolves.toEqual({
      deleted: 3,
      failedGroups: 1,
    });
    repo.pruneGroup
      .mockRejectedValueOnce(new Error('deadlock detected'))
      .mockResolvedValueOnce(3);
    let tracked: unknown;
    cronJobService.executeWithTracking.mockImplementationOnce(
      async (_name: string, fn: () => Promise<unknown>) => {
        tracked = await fn();
        return tracked;
      },
    );
    await cron.prune();
    expect(tracked).toEqual({ degraded: true });
  });
});
