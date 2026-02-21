import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { lt } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { CronJobService } from '../cron-jobs/cron-job.service';

@Injectable()
export class SessionCleanupService {
  private readonly logger = new Logger(SessionCleanupService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly cronJobService: CronJobService,
  ) {}

  @Cron('0 3 * * *', { name: 'SessionCleanupService_cleanupExpiredSessions' })
  async cleanupExpiredSessions(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'SessionCleanupService_cleanupExpiredSessions',
      async () => {
        const result = await this.db
          .delete(schema.sessions)
          .where(lt(schema.sessions.expiresAt, new Date()))
          .returning({ id: schema.sessions.id });

        if (result.length > 0) {
          this.logger.log(`Cleaned up ${result.length} expired sessions`);
        }
      },
    );
  }
}
