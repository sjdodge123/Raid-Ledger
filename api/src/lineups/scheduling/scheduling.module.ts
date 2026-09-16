/**
 * Scheduling sub-module (ROK-965).
 * Handles schedule poll page, slot suggestions, voting, and event creation.
 */
import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DrizzleModule } from '../../drizzle/drizzle.module';
import { EventsModule } from '../../events/events.module';
import { DiscordBotModule } from '../../discord-bot/discord-bot.module';
import { SettingsModule } from '../../settings/settings.module';
import { NotificationModule } from '../../notifications/notification.module';
import { CronJobModule } from '../../cron-jobs/cron-job.module';
import { LineupsModule } from '../lineups.module';
import { SchedulingController } from './scheduling.controller';
import { SchedulingBannerController } from './scheduling-banner.controller';
import { SchedulingService } from './scheduling.service';
import { SchedulingPollEmbedService } from './scheduling-poll-embed.service';
import { SchedulingRemindService } from './scheduling-remind.service';
import { SchedulingMembersService } from './scheduling-members.service';
import { SchedulingPollNudgeService } from './scheduling-poll-nudge.service';
import {
  SCHEDULING_POLL_EMBED_QUEUE,
  SchedulingPollEmbedQueueService,
} from './scheduling-poll-embed.queue';
import { SchedulingPollEmbedProcessor } from './scheduling-poll-embed.processor';
import { SchedulingPollExpiryService } from './scheduling-poll-expiry.service';

@Module({
  imports: [
    DrizzleModule,
    EventsModule,
    DiscordBotModule,
    SettingsModule,
    NotificationModule,
    // Supplies CronJobService for the recurring poll-nudge cron.
    CronJobModule,
    forwardRef(() => LineupsModule),
    // ROK-1549: debounced, retried poll-card re-render.
    BullModule.registerQueue({ name: SCHEDULING_POLL_EMBED_QUEUE }),
  ],
  controllers: [SchedulingController, SchedulingBannerController],
  providers: [
    SchedulingService,
    SchedulingPollEmbedService,
    SchedulingRemindService,
    SchedulingMembersService,
    SchedulingPollNudgeService,
    SchedulingPollEmbedQueueService,
    SchedulingPollEmbedProcessor,
    // ROK-1604: warn the creator before an unlocked poll expires.
    SchedulingPollExpiryService,
  ],
  exports: [SchedulingService, SchedulingPollEmbedService],
})
export class SchedulingModule {}
