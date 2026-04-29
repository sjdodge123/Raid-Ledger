import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { CronJobModule } from '../cron-jobs/cron-job.module';
import { SlowQueriesService } from './slow-queries.service';
import { SlowQueriesCron } from './slow-queries.cron';

/**
 * SlowQueriesModule (ROK-1156).
 * Hourly cron reads `pg_stat_statements` and appends a fixed-width digest to
 * the slow-queries log file. The file surfaces on the admin Logs page and is
 * bundled into the existing tar export.
 */
@Module({
  imports: [DrizzleModule, CronJobModule],
  providers: [SlowQueriesService, SlowQueriesCron],
  exports: [SlowQueriesService],
})
export class SlowQueriesModule {}
