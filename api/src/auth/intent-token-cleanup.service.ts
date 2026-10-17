import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { lt } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { CronJobService } from '../cron-jobs/cron-job.service';

/** Cleanup threshold: 15 minutes (matches intent token JWT expiry) */
const CLEANUP_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * Cron service that purges consumed intent tokens older than 15 minutes.
 * Tokens are only valid for 15 minutes (JWT expiry), so consumed rows
 * beyond that window can be safely deleted (ROK-979).
 */
@Injectable()
export class IntentTokenCleanupService {
  private readonly logger = new Logger(IntentTokenCleanupService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly cronJobService: CronJobService,
  ) {}

  /**
   * Delete consumed intent token rows where consumed_at is older than 15 minutes.
   * Runs every 5 minutes via NestJS @Cron decorator.
   */
  @Cron('0 */5 * * * *', {
    name: 'IntentTokenCleanupService_cleanupExpiredTokens',
  })
  async cleanupExpiredTokens(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'IntentTokenCleanupService_cleanupExpiredTokens',
      async () => {
        const cutoff = new Date(Date.now() - CLEANUP_THRESHOLD_MS);

        const result = await this.db
          .delete(schema.consumedIntentTokens)
          .where(lt(schema.consumedIntentTokens.consumedAt, cutoff));

        if (result.count > 0) {
          this.logger.log(`Cleaned up ${result.count} expired intent tokens`);
        }
      },
    );
  }
}
