import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronJobService } from '../../../cron-jobs/cron-job.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { BG3_PLUGIN_ID, BG3_SESSION_GAP_MS } from '../bg3.constants';
import { retentionCutoff } from './bg3-retention.helpers';
import { Bg3RetentionRepository } from './bg3-retention.repository';

/** = `BG3_RETENTION_JOB_NAME`; a literal so the ROK-1969 `@Cron` scan resolves it. */
const JOB_NAME = 'Bg3HistoryRetentionCron_prune';

/**
 * ROK-1957 D-9 — daily at 05:15 (after the companion blob cleanup at
 * 04:35): thin save history older than 90 days to one save per session.
 * An inactive `bg3` plugin returns before the tracked run.
 */
@Injectable()
export class Bg3HistoryRetentionCron {
  private readonly logger = new Logger(Bg3HistoryRetentionCron.name);

  constructor(
    private readonly repo: Bg3RetentionRepository,
    private readonly cronJobService: CronJobService,
    private readonly registry: PluginRegistryService,
  ) {}

  @Cron('0 15 5 * * *', { name: JOB_NAME })
  async prune(): Promise<void> {
    if (!this.registry.isActive(BG3_PLUGIN_ID)) return;
    await this.cronJobService.executeWithTracking(
      JOB_NAME,
      async () => (await this.runOnce()) > 0,
    );
  }

  /** One pass over at most 200 groups; returns the rows deleted. */
  async runOnce(now: Date = new Date()): Promise<number> {
    const cutoff = retentionCutoff(now);
    const groups = await this.repo.listGroups(cutoff, BG3_SESSION_GAP_MS);
    let deleted = 0;
    for (const g of groups) {
      deleted += await this.repo.pruneGroup(g, cutoff, now, BG3_SESSION_GAP_MS);
    }
    if (deleted > 0)
      this.logger.log(`BG3 retention: ${deleted} save(s) thinned`);
    return deleted;
  }
}
