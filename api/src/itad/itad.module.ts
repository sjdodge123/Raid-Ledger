import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ItadService } from './itad.service';
import { ItadPriceService } from './itad-price.service';
import { ItadPriceSyncService } from './itad-price-sync.service';
import { ItadPriceSyncProcessor } from './itad-price-sync.processor';
import { ITAD_PRICE_SYNC_QUEUE } from './itad-price-sync.constants';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { RedisModule } from '../redis/redis.module';
import { SettingsModule } from '../settings/settings.module';
import { CronJobModule } from '../cron-jobs/cron-job.module';

@Module({
  imports: [
    DrizzleModule,
    RedisModule,
    SettingsModule,
    CronJobModule,
    BullModule.registerQueue({ name: ITAD_PRICE_SYNC_QUEUE }),
  ],
  providers: [
    ItadService,
    ItadPriceService,
    ItadPriceSyncService,
    ItadPriceSyncProcessor,
  ],
  exports: [ItadService, ItadPriceService, BullModule],
})
export class ItadModule {}
