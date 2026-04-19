import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LineupsController } from './lineups.controller';
import { LineupsService } from './lineups.service';
import { LineupSteamNudgeService } from './lineup-steam-nudge.service';
import { LineupNotificationService } from './lineup-notification.service';
import { LineupReminderService } from './lineup-reminder.service';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { NotificationModule } from '../notifications/notification.module';
import { DiscordBotModule } from '../discord-bot/discord-bot.module';
import { SettingsModule } from '../settings/settings.module';
import { LINEUP_PHASE_QUEUE } from './queue/lineup-phase.constants';
import { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import { LineupPhaseProcessor } from './queue/lineup-phase.processor';
import { TiebreakerModule } from './tiebreaker/tiebreaker.module';
import { TasteProfileModule } from '../taste-profile/taste-profile.module';

@Module({
  imports: [
    DrizzleModule,
    ActivityLogModule,
    NotificationModule,
    forwardRef(() => DiscordBotModule),
    SettingsModule,
    BullModule.registerQueue({ name: LINEUP_PHASE_QUEUE }),
    TiebreakerModule,
    TasteProfileModule,
  ],
  controllers: [LineupsController],
  providers: [
    LineupsService,
    LineupSteamNudgeService,
    LineupNotificationService,
    LineupReminderService,
    LineupPhaseQueueService,
    LineupPhaseProcessor,
  ],
  exports: [LineupsService, LineupSteamNudgeService, LineupNotificationService],
})
export class LineupsModule {}
