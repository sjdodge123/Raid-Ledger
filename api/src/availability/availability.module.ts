import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { AvailabilityController } from './availability.controller';
import { DrizzleModule } from '../drizzle/drizzle.module';

/**
 * Module for managing user availability windows (ROK-112).
 * Provides CRUD operations and conflict detection for scheduling.
 */
@Module({
    imports: [DrizzleModule],
    controllers: [AvailabilityController],
    providers: [AvailabilityService],
    exports: [AvailabilityService],
})
export class AvailabilityModule { }
