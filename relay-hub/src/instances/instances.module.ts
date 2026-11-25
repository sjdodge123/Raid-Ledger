import { Module } from '@nestjs/common';
import { HubBearerGuard } from '../auth/bearer.guard';
import { HealthModule } from '../health/health.module';
import { HeartbeatController } from './heartbeat.controller';
import { InstancesLifecycleRepository } from './instances-lifecycle.repository';
import { InstancesController } from './instances.controller';
import { InstancesRepository } from './instances.repository';
import { InstancesService } from './instances.service';

@Module({
  imports: [HealthModule],
  controllers: [InstancesController, HeartbeatController],
  providers: [
    InstancesRepository,
    InstancesLifecycleRepository,
    InstancesService,
    HubBearerGuard,
  ],
})
export class InstancesModule {}
