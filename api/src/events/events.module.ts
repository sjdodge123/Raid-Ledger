import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';
import { EventsController } from './events.controller';

@Module({
  controllers: [EventsController],
  providers: [EventsService, SignupsService],
  exports: [EventsService, SignupsService],
})
export class EventsModule {}
