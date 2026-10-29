import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BG3_GALLERY_SYNC_JOB_NAME } from '@raid-ledger/contract';
import { CronJobService } from '../../../cron-jobs/cron-job.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { BG3_PLUGIN_ID } from '../bg3.constants';
import { Bg3GallerySyncService } from './bg3-gallery-sync.service';

/**
 * ROK-1959 D-3 — every 15 minutes, copy one picture per closed BG3 session
 * into the hub Gallery. An inactive `bg3` plugin returns before the tracked
 * run (its pictures are hidden by the media gate meanwhile).
 */
@Injectable()
export class Bg3GallerySyncCron {
  constructor(
    private readonly sync: Bg3GallerySyncService,
    private readonly cronJobService: CronJobService,
    private readonly registry: PluginRegistryService,
  ) {}

  @Cron('0 */15 * * * *', { name: BG3_GALLERY_SYNC_JOB_NAME })
  async run(): Promise<void> {
    if (!this.registry.isActive(BG3_PLUGIN_ID)) return;
    await this.cronJobService.executeWithTracking(
      BG3_GALLERY_SYNC_JOB_NAME,
      async () => {
        const run = await this.sync.runOnce();
        return run.failedHubs > 0 ? { degraded: true } : run.stored > 0;
      },
    );
  }
}
