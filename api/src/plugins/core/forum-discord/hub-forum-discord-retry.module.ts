import { Module } from '@nestjs/common';
import { CronJobModule } from '../../../cron-jobs/cron-job.module';
import { HubForumDiscordModule } from '../../../guilds/forum/discord/hub-forum-discord.module';
import { HubForumDiscordRetryCron } from './hub-forum-discord-retry.cron';

/** ROK-2208 §5.6 — Core's forum → Discord retry cron (sweep lives in the forum module). */
@Module({
  imports: [HubForumDiscordModule, CronJobModule],
  providers: [HubForumDiscordRetryCron],
})
export class HubForumDiscordRetryModule {}
