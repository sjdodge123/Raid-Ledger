/**
 * Scheduling sub-module (ROK-965).
 * Handles schedule poll page, slot suggestions, voting, and event creation.
 */
import { Module, forwardRef } from '@nestjs/common';
import { DrizzleModule } from '../../drizzle/drizzle.module';
import { EventsModule } from '../../events/events.module';
import { LineupsModule } from '../lineups.module';
import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';

@Module({
  imports: [DrizzleModule, EventsModule, forwardRef(() => LineupsModule)],
  controllers: [SchedulingController],
  providers: [SchedulingService],
  exports: [SchedulingService],
})
export class SchedulingModule {}
