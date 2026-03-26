import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { RosterNotificationBufferService } from './roster-notification-buffer.service';
import { EventReminderService } from './event-reminder.service';
import { RoleGapAlertService } from './role-gap-alert.service';
import { PostEventReminderService } from './post-event-reminder.service';
import { DiscordNotificationService } from './discord-notification.service';
import { DiscordNotificationProcessor } from './discord-notification.processor';
import { DiscordNotificationEmbedService } from './discord-notification-embed.service';
import { GameAffinityNotificationService } from './game-affinity-notification.service';
import { LiveNoShowService } from './live-noshow.service';
import { RecruitmentReminderService } from './recruitment-reminder.service';
import { NotificationDedupService } from './notification-dedup.service';
import { DISCORD_NOTIFICATION_QUEUE } from './discord-notification.constants';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { CronJobModule } from '../cron-jobs/cron-job.module';
import { DiscordBotModule } from '../discord-bot/discord-bot.module';
import { EventsModule } from '../events/events.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    DrizzleModule,
    CronJobModule,
    forwardRef(() => DiscordBotModule),
    forwardRef(() => EventsModule),
    SettingsModule,
    BullModule.registerQueue({ name: DISCORD_NOTIFICATION_QUEUE }),
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    RosterNotificationBufferService,
    EventReminderService,
    RoleGapAlertService,
    PostEventReminderService,
    DiscordNotificationService,
    DiscordNotificationProcessor,
    DiscordNotificationEmbedService,
    GameAffinityNotificationService,
    LiveNoShowService,
    RecruitmentReminderService,
    NotificationDedupService,
  ],
  exports: [
    NotificationService,
    RosterNotificationBufferService,
    DiscordNotificationService,
    GameAffinityNotificationService,
    RecruitmentReminderService,
  ],
})
export class NotificationModule {}
