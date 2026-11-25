import { Module } from '@nestjs/common';
import { EpochService } from './epoch.service';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  providers: [EpochService],
  exports: [EpochService],
})
export class HealthModule {}
