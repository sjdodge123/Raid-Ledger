/**
 * ROK-2187 — Core's GG <year> delivery tick, every 5 minutes. Pausing the job
 * on the Jobs page (or GG_ENABLED=false) stops every send (AC11).
 * Declared as `GgDeliveryCron_tick` under `core` in HUB_PLUGIN_MANIFESTS.
 */
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { CronJobService } from '../../../cron-jobs/cron-job.service';
import { GgDeliveryService } from './gg-delivery.service';

/** SchedulerRegistry name — matches the manifest + cron metadata. */
export const GG_DELIVERY_JOB_NAME = 'GgDeliveryCron_tick';

/** True when an admin paused `GgDeliveryCron_tick` on the Jobs page (AC11). */
export async function isGgDeliveryJobPaused(
  db: PostgresJsDatabase<typeof schema>,
): Promise<boolean> {
  const [row] = await db
    .select({ paused: schema.cronJobs.paused })
    .from(schema.cronJobs)
    .where(eq(schema.cronJobs.name, GG_DELIVERY_JOB_NAME))
    .limit(1);
  return row?.paused === true;
}

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
        if (outcome.status === 'dm-wave') return outcome.dm.claimed > 0;
        return outcome.status === 'waiting-offset';
      },
    );
  }
}
