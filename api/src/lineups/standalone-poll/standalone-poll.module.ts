/**
 * NestJS module for standalone scheduling polls (ROK-977).
 * Self-contained: registers its own BullMQ queue rather than
 * depending on LineupsModule exporting LineupPhaseQueueService.
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DrizzleModule } from '../../drizzle/drizzle.module';
import { NotificationModule } from '../../notifications/notification.module';
import { LINEUP_PHASE_QUEUE } from '../queue/lineup-phase.constants';
import { LineupPhaseQueueService } from '../queue/lineup-phase.queue';
import { StandalonePollController } from './standalone-poll.controller';
import { StandalonePollService } from './standalone-poll.service';
import { StandalonePollNotificationService } from './standalone-poll-notification.service';

@Module({
  imports: [
    DrizzleModule,
    NotificationModule,
    BullModule.registerQueue({ name: LINEUP_PHASE_QUEUE }),
  ],
  controllers: [StandalonePollController],
  providers: [
    StandalonePollService,
    StandalonePollNotificationService,
    LineupPhaseQueueService,
  ],
  exports: [StandalonePollService],
})
export class StandalonePollModule {}
