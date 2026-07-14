/**
 * Co-Optimus enrichment module (ROK-1397).
 * Transport-stubbed: fully wired but a silent no-op until the operator
 * configures the allowlisted user-agent (permission-first, ROK-275).
 */
import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { RedisModule } from '../redis/redis.module';
import { SettingsModule } from '../settings/settings.module';
import { CronJobModule } from '../cron-jobs/cron-job.module';
import { CooptimusService } from './cooptimus.service';
import { CooptimusSyncService } from './cooptimus-sync.service';

@Module({
  imports: [DrizzleModule, RedisModule, SettingsModule, CronJobModule],
  providers: [CooptimusService, CooptimusSyncService],
  exports: [CooptimusService, CooptimusSyncService],
})
export class CooptimusModule {}
