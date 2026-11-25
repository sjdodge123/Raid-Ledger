import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { HubExceptionFilter } from './common/hub-exception.filter';
import { HubConfigModule } from './config/hub-config.module';
import { DrizzleModule } from './drizzle/drizzle.module';
import { HealthModule } from './health/health.module';
import { InstancesModule } from './instances/instances.module';

@Module({
  imports: [HubConfigModule, DrizzleModule, HealthModule, InstancesModule],
  providers: [{ provide: APP_FILTER, useClass: HubExceptionFilter }],
})
export class AppModule {}
