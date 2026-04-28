import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { CronJobModule } from '../cron-jobs/cron-job.module';
import { SlowQueriesService } from './slow-queries.service';
import { SlowQueriesCron } from './slow-queries.cron';
import { SlowQueriesController } from './slow-queries.controller';

/**
 * SlowQueriesModule (ROK-1156).
 * Daily 06:00 UTC cron snapshots `pg_stat_statements` and exposes a
 * diffed digest on the admin Logs page.
 */
@Module({
  imports: [DrizzleModule, CronJobModule],
  controllers: [SlowQueriesController],
  providers: [SlowQueriesService, SlowQueriesCron],
  exports: [SlowQueriesService],
})
export class SlowQueriesModule {}
