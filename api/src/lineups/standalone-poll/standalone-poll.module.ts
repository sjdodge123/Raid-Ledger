/**
 * NestJS module for standalone scheduling polls (ROK-977).
 * Consumes the single `LineupPhaseQueueService` provider exported by
 * `LineupsModule` rather than registering its own queue + provider
 * (ROK-1206) — two providers meant two `reconcileArchiveJobs()` runs
 * at boot.
 */
import { Module, forwardRef } from '@nestjs/common';
import { DrizzleModule } from '../../drizzle/drizzle.module';
import { NotificationModule } from '../../notifications/notification.module';
import { SettingsModule } from '../../settings/settings.module';
import { CronJobModule } from '../../cron-jobs/cron-job.module';
import { LineupsModule } from '../lineups.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { EventsModule } from '../../events/events.module';
import { DiscordBotModule } from '../../discord-bot/discord-bot.module';
import { StandalonePollController } from './standalone-poll.controller';
import { StandalonePollService } from './standalone-poll.service';
import { StandalonePollNotificationService } from './standalone-poll-notification.service';
import { StandalonePollReminderService } from './standalone-poll-reminder.service';

@Module({
  imports: [
    DrizzleModule,
    NotificationModule,
    SettingsModule,
    SchedulingModule,
    EventsModule,
    CronJobModule,
    LineupsModule,
    // ROK-1392: the reschedule-poll lock-in enqueues an explicit embed sync to
    // restore the linked event's live card. forwardRef mirrors LineupsModule —
    // DiscordBotModule imports EventsModule, so the cycle must resolve lazily.
    forwardRef(() => DiscordBotModule),
  ],
  controllers: [StandalonePollController],
  providers: [
    StandalonePollService,
    StandalonePollNotificationService,
    StandalonePollReminderService,
  ],
  exports: [StandalonePollService, StandalonePollReminderService],
})
export class StandalonePollModule {}
