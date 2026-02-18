import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { EventReminderService } from './event-reminder.service';
import { DiscordNotificationService } from './discord-notification.service';
import { DiscordNotificationProcessor } from './discord-notification.processor';
import { DiscordNotificationEmbedService } from './discord-notification-embed.service';
import { DISCORD_NOTIFICATION_QUEUE } from './discord-notification.constants';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { CronJobModule } from '../cron-jobs/cron-job.module';
import { DiscordBotModule } from '../discord-bot/discord-bot.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    DrizzleModule,
    CronJobModule,
    DiscordBotModule,
    SettingsModule,
    BullModule.registerQueue({ name: DISCORD_NOTIFICATION_QUEUE }),
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    EventReminderService,
    DiscordNotificationService,
    DiscordNotificationProcessor,
    DiscordNotificationEmbedService,
  ],
  exports: [NotificationService, DiscordNotificationService],
})
export class NotificationModule {}
