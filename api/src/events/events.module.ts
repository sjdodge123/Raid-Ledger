import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';
import { TemplatesService } from './templates.service';
import { EventsController } from './events.controller';
import { TemplatesController } from './templates.controller';
import { AvailabilityModule } from '../availability/availability.module';
import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [AvailabilityModule, NotificationModule],
  controllers: [EventsController, TemplatesController],
  providers: [EventsService, SignupsService, TemplatesService],
  exports: [EventsService, SignupsService],
})
export class EventsModule {}
