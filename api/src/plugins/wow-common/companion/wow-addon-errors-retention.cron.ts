/**
 * ROK-2099 D7 (operator ruling 2026-11-19): an addon-error row is kept for
 * 90 days after it was last seen. An error still firing keeps its row alive
 * through `last_seen_at`. Owned by `blizzard`: an inactive plugin returns
 * before the tracked run. (A revoked device's rows go at once — core's
 * `CompanionDeviceRevokedListener`, not this job.)
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { CronJobService } from '../../../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { WOW_COMMON_MANIFEST } from '../manifest';

export const WOW_ADDON_ERRORS_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;

/** A literal in `@Cron` below too, so the ROK-1969 `@Cron` scan resolves it. */
export const WOW_ADDON_ERRORS_RETENTION_JOB = 'WowAddonErrorsRetention_prune';

/** Rows last seen strictly before this instant are deleted. */
export function addonErrorsRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - WOW_ADDON_ERRORS_RETENTION_DAYS * DAY_MS);
}

@Injectable()
export class WowAddonErrorsRetentionCron {
  private readonly logger = new Logger(WowAddonErrorsRetentionCron.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly cronJobService: CronJobService,
    private readonly registry: PluginRegistryService,
  ) {}

  /** Daily at 05:45, after the BG3 retention pass at 05:15. */
  @Cron('0 45 5 * * *', { name: 'WowAddonErrorsRetention_prune' })
  async prune(): Promise<void> {
    if (!this.registry.isActive(WOW_COMMON_MANIFEST.id)) return;
    await this.cronJobService.executeWithTracking(
      WOW_ADDON_ERRORS_RETENTION_JOB,
      async () => (await this.runOnce()) > 0,
    );
  }

  /** One delete; returns the number of rows removed. */
  async runOnce(now: Date = new Date()): Promise<number> {
    const t = schema.wowAddonErrorRecords;
    const gone = await this.db
      .delete(t)
      .where(lt(t.lastSeenAt, addonErrorsRetentionCutoff(now)))
      .returning({ id: t.id });
    if (gone.length > 0)
      this.logger.log(`addon errors: ${gone.length} row(s) past retention`);
    return gone.length;
  }
}
