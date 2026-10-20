import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { ReconcileResultDto } from '@raid-ledger/contract';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { SettingsService } from '../../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelLifecycleService } from './channel-lifecycle.service';

/** The cron job name (also the `cron_jobs` tracking row). */
export const LIFECYCLE_CRON_NAME = 'ChannelLifecycleScheduler_reconcile';

/**
 * ROK-1431 — the daily reconcile (D12: `0 15 4 * * *`) through
 * `executeWithTracking`, gated on bot connectivity + the enabled setting, and
 * `reconcileNow()` for the admin "Reconcile now" route (L6).
 */
@Injectable()
export class ChannelLifecycleScheduler {
  private readonly logger = new Logger(ChannelLifecycleScheduler.name);

  constructor(
    private readonly lifecycle: ChannelLifecycleService,
    private readonly cronJobs: CronJobService,
    private readonly client: DiscordBotClientService,
    private readonly settings: SettingsService,
  ) {}

  /** Daily tick; a no-op when disabled, offline or another run holds the lock. */
  @Cron('0 15 4 * * *', { name: LIFECYCLE_CRON_NAME })
  async handleCron(): Promise<void> {
    if (!this.client.isConnected()) return;
    const { enabled } = await this.settings.getChannelLifecycleSettings();
    if (!enabled) return;
    await this.cronJobs.executeWithTracking(LIFECYCLE_CRON_NAME, () =>
      this.runCronTick(),
    );
  }

  /** One tracked tick; a concurrent run (409) is skipped, not an error. */
  private async runCronTick(): Promise<void> {
    try {
      await this.lifecycle.reconcile({ dryRun: false, trigger: 'cron' });
    } catch (err) {
      if (!(err instanceof ConflictException)) throw err;
      this.logger.log('Reconcile already running; skipping the cron tick');
    }
  }

  /**
   * Admin "Reconcile now" (L6). Dry run by default (spec §2.3).
   *
   * @throws ConflictException when a reconcile is already running
   */
  reconcileNow(dryRun = true): Promise<ReconcileResultDto> {
    return this.lifecycle.reconcile({ dryRun, trigger: 'manual' });
  }
}
