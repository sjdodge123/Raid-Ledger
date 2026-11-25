import { Module } from '@nestjs/common';
import { HubConfigModule } from './config/hub-config.module';
import { HealthModule } from './health/health.module';

@Module({ imports: [HubConfigModule, HealthModule] })
export class AppModule {}
