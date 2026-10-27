import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { CronJobService } from '../../cron-jobs/cron-job.service';

const JOB = 'CompanionDeviceLinkCleanupService_purgeExpiredLinks';

/**
 * ROK-1955 §4: deletes device-link rows more than 24 h past `expires_at`
 * (IntentTokenCleanupService precedent). Issued devices are untouched —
 * `companion_device_links.device_id` is the child side of the FK.
 */
@Injectable()
export class CompanionDeviceLinkCleanupService {
  private readonly logger = new Logger(CompanionDeviceLinkCleanupService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly cronJobService: CronJobService,
  ) {}

  /** Daily at 04:20. */
  @Cron('0 20 4 * * *', { name: JOB })
  async purgeExpiredLinks(): Promise<void> {
    await this.cronJobService.executeWithTracking(JOB, async () => {
      const result = await this.db
        .delete(schema.companionDeviceLinks)
        .where(
          lt(
            schema.companionDeviceLinks.expiresAt,
            sql`now() - interval '24 hours'`,
          ),
        );
      if (result.count > 0) {
        this.logger.log(
          `Purged ${result.count} expired companion device links`,
        );
      }
    });
  }
}
