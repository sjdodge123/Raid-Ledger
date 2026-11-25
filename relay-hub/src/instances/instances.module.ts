import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import { InstancesController } from './instances.controller';
import { InstancesRepository } from './instances.repository';
import { InstancesService } from './instances.service';

@Module({
  imports: [HealthModule],
  controllers: [InstancesController],
  providers: [InstancesRepository, InstancesService],
})
export class InstancesModule {}
