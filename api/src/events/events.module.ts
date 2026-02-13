import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';
import { PugsService } from './pugs.service';
import { TemplatesService } from './templates.service';
import { EventsController } from './events.controller';
import { TemplatesController } from './templates.controller';
import { AvailabilityModule } from '../availability/availability.module';
import { NotificationModule } from '../notifications/notification.module';
import {
  BenchPromotionService,
  BenchPromotionProcessor,
  BENCH_PROMOTION_QUEUE,
} from './bench-promotion.service';

@Module({
  imports: [
    AvailabilityModule,
    NotificationModule,
    BullModule.registerQueue({ name: BENCH_PROMOTION_QUEUE }),
  ],
  controllers: [EventsController, TemplatesController],
  providers: [
    EventsService,
    SignupsService,
    PugsService,
    TemplatesService,
    BenchPromotionService,
    BenchPromotionProcessor,
  ],
  exports: [EventsService, SignupsService, PugsService],
})
export class EventsModule {}
