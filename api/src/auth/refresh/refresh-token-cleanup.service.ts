import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { lt, or, isNotNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { CronJobService } from '../../cron-jobs/cron-job.service';

/**
 * ROK-1353: prune expired and revoked refresh-token rows daily.
 * Mirrors SessionCleanupService — tracked via CronJobService and registered
 * in CORE_JOB_METADATA so cron-job.constants.spec stays green.
 */
@Injectable()
export class RefreshTokenCleanupService {
  private readonly logger = new Logger(RefreshTokenCleanupService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly cronJobService: CronJobService,
  ) {}

  @Cron('40 0 3 * * *', {
    name: 'RefreshTokenCleanupService_cleanupExpiredTokens',
  })
  async cleanupExpiredTokens(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'RefreshTokenCleanupService_cleanupExpiredTokens',
      async () => {
        const result = await this.db
          .delete(schema.refreshTokens)
          .where(
            or(
              lt(schema.refreshTokens.expiresAt, new Date()),
              isNotNull(schema.refreshTokens.revokedAt),
            ),
          );
        if (result.count === 0) return false;
        this.logger.log(`Cleaned up ${result.count} refresh token(s)`);
      },
    );
  }
}
