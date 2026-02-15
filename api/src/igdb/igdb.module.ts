import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { IgdbService } from './igdb.service';
import { IgdbController } from './igdb.controller';
import { IgdbSyncProcessor } from './igdb-sync.processor';
import { IGDB_SYNC_QUEUE } from './igdb-sync.constants';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { RedisModule } from '../redis/redis.module';
import { SettingsModule } from '../settings/settings.module';
import { CronJobModule } from '../cron-jobs/cron-job.module';

@Module({
  imports: [
    ConfigModule,
    DrizzleModule,
    RedisModule,
    SettingsModule,
    BullModule.registerQueue({ name: IGDB_SYNC_QUEUE }),
    CronJobModule,
  ],
  controllers: [IgdbController],
  providers: [IgdbService, IgdbSyncProcessor],
  exports: [IgdbService],
})
export class IgdbModule {}
