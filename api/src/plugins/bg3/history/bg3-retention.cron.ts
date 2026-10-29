import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronJobService } from '../../../cron-jobs/cron-job.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { BG3_PLUGIN_ID, BG3_SESSION_GAP_MS } from '../bg3.constants';
import { retentionCutoff } from './bg3-retention.helpers';
import {
  Bg3RetentionRepository,
  type Bg3RetentionGroup,
} from './bg3-retention.repository';

/** One pass: rows deleted, and groups whose prune threw (rolled back). */
export interface Bg3RetentionRun {
  deleted: number;
  failedGroups: number;
}

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
    await this.cronJobService.executeWithTracking(JOB_NAME, async () => {
      const run = await this.runOnce();
      return run.failedGroups > 0 ? { degraded: true } : run.deleted > 0;
    });
  }

  /**
   * One pass over at most 200 groups. Each group prunes in its own tx; one
   * that throws is logged and skipped (review fix 8). The ref cutoff is the
   * run start on the DB clock (review fix 10); `now` drives only the 90-day
   * cutoff.
   */
  async runOnce(now: Date = new Date()): Promise<Bg3RetentionRun> {
    const cutoff = retentionCutoff(now);
    const groups = await this.repo.listGroups(cutoff, BG3_SESSION_GAP_MS);
    const startedAt = await this.repo.dbNow();
    const run: Bg3RetentionRun = { deleted: 0, failedGroups: 0 };
    for (const g of groups) await this.pruneOne(g, cutoff, startedAt, run);
    if (run.deleted > 0)
      this.logger.log(`BG3 retention: ${run.deleted} save(s) thinned`);
    return run;
  }

  private async pruneOne(
    g: Bg3RetentionGroup,
    cutoff: Date,
    startedAt: Date,
    run: Bg3RetentionRun,
  ): Promise<void> {
    try {
      run.deleted += await this.repo.pruneGroup(
        g,
        cutoff,
        startedAt,
        BG3_SESSION_GAP_MS,
      );
    } catch (err) {
      run.failedGroups += 1;
      this.logger.error(
        `BG3 retention: group ${g.userId}/${g.campaignId ?? 'unassigned'} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
