import { BG3_GALLERY_SYNC_JOB_NAME } from '@raid-ledger/contract';
import type { CronJobService } from '../../../cron-jobs/cron-job.service';
import type { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { BG3_PLUGIN_ID } from '../bg3.constants';
import { Bg3GallerySyncCron } from './bg3-gallery-sync.cron';
import type { Bg3GallerySyncService } from './bg3-gallery-sync.service';

function setup(
  active: boolean,
  run = { stored: 1, skipped: 0, failedHubs: 0 },
) {
  const sync = { runOnce: jest.fn().mockResolvedValue(run) };
  let tracked: unknown;
  const cron = {
    executeWithTracking: jest.fn(
      async (_name: string, fn: () => Promise<unknown>) => {
        tracked = await fn();
      },
    ),
  };
  const registry = { isActive: jest.fn().mockReturnValue(active) };
  const job = new Bg3GallerySyncCron(
    sync as unknown as Bg3GallerySyncService,
    cron as unknown as CronJobService,
    registry as unknown as PluginRegistryService,
  );
  return { job, sync, cron, registry, tracked: () => tracked };
}

describe('Bg3GallerySyncCron (ROK-1959 D-3)', () => {
  it('returns before the tracked run while bg3 is inactive', async () => {
    const { job, sync, cron, registry } = setup(false);
    await job.run();
    expect(registry.isActive).toHaveBeenCalledWith(BG3_PLUGIN_ID);
    expect(cron.executeWithTracking).not.toHaveBeenCalled();
    expect(sync.runOnce).not.toHaveBeenCalled();
  });

  it('runs one tracked pass under the contract job name while active', async () => {
    const { job, sync, cron, tracked } = setup(true);
    await job.run();
    expect(cron.executeWithTracking).toHaveBeenCalledWith(
      BG3_GALLERY_SYNC_JOB_NAME,
      expect.any(Function),
    );
    expect(sync.runOnce).toHaveBeenCalledTimes(1);
    expect(tracked()).toBe(true);
  });

  it('reports a degraded run when a hub failed', async () => {
    const { job, tracked } = setup(true, {
      stored: 0,
      skipped: 0,
      failedHubs: 1,
    });
    await job.run();
    expect(tracked()).toEqual({ degraded: true });
  });
});
