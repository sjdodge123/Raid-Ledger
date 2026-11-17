/**
 * ROK-2208 §5.7 item 4 (R12) — Core's event-thread lock sweep, every 5
 * minutes (offset 30 s from the retry sweep): locks + archives the Discord
 * post of a read-only event thread, and reopens it after a reschedule.
 * Declared as `HubForumDiscordSync_eventLockSweep` under `core` in
 * HUB_PLUGIN_MANIFESTS (CLAUDE.md: hub behaviours belong to a plugin).
 */
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronJobService } from '../../../cron-jobs/cron-job.service';
import { HubForumDiscordEventLockSweep } from '../../../guilds/forum/discord/hub-forum-discord-event-lock';

/** SchedulerRegistry name — matches the manifest + cron metadata. */
export const HUB_FORUM_DISCORD_EVENT_LOCK_JOB =
  'HubForumDiscordSync_eventLockSweep';

/** The 5-minute event-thread lock tick. */
@Injectable()
export class HubForumDiscordEventLockCron {
  constructor(
    private readonly lockSweep: HubForumDiscordEventLockSweep,
    private readonly cronJobService: CronJobService,
  ) {}

  /** `false` = nothing flipped, so idle ticks don't read as work done. */
  @Cron('30 */5 * * * *', { name: 'HubForumDiscordSync_eventLockSweep' })
  async sweep(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      HUB_FORUM_DISCORD_EVENT_LOCK_JOB,
      async () => (await this.lockSweep.sweep()) > 0,
    );
  }
}
