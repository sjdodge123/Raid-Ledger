import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LineupsController } from './lineups.controller';
import { LineupsService } from './lineups.service';
import { LineupSteamNudgeService } from './lineup-steam-nudge.service';
import { LineupNotificationService } from './lineup-notification.service';
import { LineupReminderService } from './lineup-reminder.service';
import { LineupsGateway } from './lineups.gateway';
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
import { AiSuggestionsModule } from './ai-suggestions/ai-suggestions.module';

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
    AiSuggestionsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '24h' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [LineupsController],
  providers: [
    LineupsService,
    LineupSteamNudgeService,
    LineupNotificationService,
    LineupReminderService,
    LineupPhaseQueueService,
    LineupPhaseProcessor,
    LineupsGateway,
  ],
  exports: [LineupsService, LineupSteamNudgeService, LineupNotificationService],
})
export class LineupsModule {}
