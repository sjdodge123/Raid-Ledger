import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { SlowQueriesService } from './slow-queries.service';

/**
 * Daily 06:00 UTC slow-query digest cron (ROK-1156).
 *
 * Captures a fresh `pg_stat_statements` snapshot, then prunes anything
 * older than 30 days. Wrapped in `executeWithTracking` so the admin
 * cron-jobs panel can surface the run history.
 */
@Injectable()
export class SlowQueriesCron {
  private readonly logger = new Logger(SlowQueriesCron.name);

  constructor(
    private readonly cronJobService: CronJobService,
    private readonly slowQueries: SlowQueriesService,
  ) {}

  @Cron('0 0 6 * * *', { name: 'SlowQueriesCron_runDigest' })
  async runDigest(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'SlowQueriesCron_runDigest',
      async () => {
        await this.slowQueries.captureSnapshot('cron');
        await this.slowQueries.pruneOldSnapshots();
      },
    );
  }
}
