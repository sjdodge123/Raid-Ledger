import { Module } from '@nestjs/common';
import { HubConfigModule } from './config/hub-config.module';
import { DrizzleModule } from './drizzle/drizzle.module';
import { HealthModule } from './health/health.module';

@Module({ imports: [HubConfigModule, DrizzleModule, HealthModule] })
export class AppModule {}
