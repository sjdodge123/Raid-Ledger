/**
 * ROK-2187 — Core's GG <year> delivery tick, every 5 minutes. Pausing the job
 * on the Jobs page (or GG_ENABLED=false) stops every send (AC11).
 * Declared as `GgDeliveryCron_tick` under `core` in HUB_PLUGIN_MANIFESTS.
 */
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronJobService } from '../../../cron-jobs/cron-job.service';
import { GgDeliveryService } from './gg-delivery.service';

/** SchedulerRegistry name — matches the manifest + cron metadata. */
export const GG_DELIVERY_JOB_NAME = 'GgDeliveryCron_tick';

@Injectable()
export class GgDeliveryCron {
  constructor(
    private readonly delivery: GgDeliveryService,
    private readonly cronJobService: CronJobService,
  ) {}

  /** `false` = a no-op tick, so off-season runs don't read as work done. */
  @Cron('0 */5 * * * *', { name: 'GgDeliveryCron_tick' })
  async tick(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      GG_DELIVERY_JOB_NAME,
      async () => {
        const outcome = await this.delivery.runTick(new Date());
        return outcome.status === 'dm-wave' || outcome.status === 'waiting-offset';
      },
    );
  }
}
