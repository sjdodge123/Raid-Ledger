import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { CronJobService } from './cron-job.service';
import { CronJobController } from './cron-job.controller';

/**
 * CronJobModule (ROK-310).
 * Provides cron job registry, tracking, and admin API.
 * Exports CronJobService so other modules can call executeWithTracking().
 * Note: AuthModule is NOT imported here to avoid circular deps —
 * passport strategies are registered globally by AppModule.
 */
@Module({
  imports: [DrizzleModule],
  controllers: [CronJobController],
  providers: [CronJobService],
  exports: [CronJobService],
})
export class CronJobModule {}
