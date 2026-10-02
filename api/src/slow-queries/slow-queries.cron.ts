import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { SlowQueriesService } from './slow-queries.service';

/**
 * Hourly slow-query digest cron (ROK-1156).
 *
 * Reads `pg_stat_statements`, formats the top-N as a fixed-width block,
 * and appends to the slow-queries log file. Wrapped in `executeWithTracking`
 * so the admin Cron Jobs panel can surface the run history.
 */
@Injectable()
export class SlowQueriesCron {
  private readonly logger = new Logger(SlowQueriesCron.name);

  constructor(
    private readonly cronJobService: CronJobService,
    private readonly slowQueries: SlowQueriesService,
  ) {}

  // :17 keeps the digest off the top-of-hour cluster (ROK-1380); not :07, where ITADPriceSync runs ('7 */4 * * *').
  @Cron('17 * * * *', { name: 'SlowQueriesCron_appendDigest' })
  async appendDigest(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'SlowQueriesCron_appendDigest',
      async () => {
        await this.slowQueries.appendDigestToLog();
      },
    );
  }
}
