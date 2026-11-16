/**
 * ROK-2208 §5.6 — Core's hub Forum → Discord retry sweep, every 5 minutes:
 * re-drives RL-origin forum posts/replies whose Discord write is still
 * pending or failed (under 5 attempts, backoff by attempts).
 * Declared as `HubForumDiscordSync_retrySweep` under `core` in
 * HUB_PLUGIN_MANIFESTS (CLAUDE.md: hub behaviours belong to a plugin).
 */
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronJobService } from '../../../cron-jobs/cron-job.service';
import { HubForumDiscordReconcileService } from '../../../guilds/forum/discord/hub-forum-discord-reconcile';

/** SchedulerRegistry name — matches the manifest + cron metadata. */
export const HUB_FORUM_DISCORD_RETRY_JOB = 'HubForumDiscordSync_retrySweep';

/** The 5-minute outbound retry tick. */
@Injectable()
export class HubForumDiscordRetryCron {
  constructor(
    private readonly reconcile: HubForumDiscordReconcileService,
    private readonly cronJobService: CronJobService,
  ) {}

  /** `false` = nothing was due, so idle ticks don't read as work done. */
  @Cron('0 */5 * * * *', { name: 'HubForumDiscordSync_retrySweep' })
  async sweep(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      HUB_FORUM_DISCORD_RETRY_JOB,
      async () => (await this.reconcile.retrySweep()) > 0,
    );
  }
}
