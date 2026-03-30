import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LineupsController } from './lineups.controller';
import { LineupsService } from './lineups.service';
import { LineupSteamNudgeService } from './lineup-steam-nudge.service';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { NotificationModule } from '../notifications/notification.module';
import { SettingsModule } from '../settings/settings.module';
import { LINEUP_PHASE_QUEUE } from './queue/lineup-phase.constants';
import { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import { LineupPhaseProcessor } from './queue/lineup-phase.processor';

@Module({
  imports: [
    DrizzleModule,
    ActivityLogModule,
    NotificationModule,
    SettingsModule,
    BullModule.registerQueue({ name: LINEUP_PHASE_QUEUE }),
  ],
  controllers: [LineupsController],
  providers: [
    LineupsService,
    LineupSteamNudgeService,
    LineupPhaseQueueService,
    LineupPhaseProcessor,
  ],
  exports: [LineupsService, LineupSteamNudgeService],
})
export class LineupsModule {}
