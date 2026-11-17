import { Module } from '@nestjs/common';
import { CronJobModule } from '../../../cron-jobs/cron-job.module';
import { HubForumDiscordModule } from '../../../guilds/forum/discord/hub-forum-discord.module';
import { HubForumDiscordEventLockCron } from './hub-forum-discord-event-lock.cron';
import { HubForumDiscordRetryCron } from './hub-forum-discord-retry.cron';

/** ROK-2208 §5.6/§5.7 — Core's forum ↔ Discord crons (sweeps live in the forum module). */
@Module({
  imports: [HubForumDiscordModule, CronJobModule],
  providers: [HubForumDiscordRetryCron, HubForumDiscordEventLockCron],
})
export class HubForumDiscordRetryModule {}
