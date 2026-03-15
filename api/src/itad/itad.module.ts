import { Module } from '@nestjs/common';
import { ItadService } from './itad.service';
import { ItadPriceService } from './itad-price.service';
import { ItadPriceSyncService } from './itad-price-sync.service';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { RedisModule } from '../redis/redis.module';
import { SettingsModule } from '../settings/settings.module';
import { CronJobModule } from '../cron-jobs/cron-job.module';

@Module({
  imports: [DrizzleModule, RedisModule, SettingsModule, CronJobModule],
  providers: [ItadService, ItadPriceService, ItadPriceSyncService],
  exports: [ItadService, ItadPriceService],
})
export class ItadModule {}
