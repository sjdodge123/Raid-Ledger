import { Module } from '@nestjs/common';
import { LineupsController } from './lineups.controller';
import { LineupsService } from './lineups.service';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [DrizzleModule, ActivityLogModule],
  controllers: [LineupsController],
  providers: [LineupsService],
  exports: [LineupsService],
})
export class LineupsModule {}
