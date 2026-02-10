import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';
import { EventsController } from './events.controller';
import { AvailabilityModule } from '../availability/availability.module';
import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [AvailabilityModule, NotificationModule],
  controllers: [EventsController],
  providers: [EventsService, SignupsService],
  exports: [EventsService, SignupsService],
})
export class EventsModule {}
