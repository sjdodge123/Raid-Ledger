import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { IgdbService } from './igdb.service';
import { IgdbController } from './igdb.controller';
import { IgdbSyncProcessor, IGDB_SYNC_QUEUE } from './igdb-sync.processor';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { RedisModule } from '../redis/redis.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    ConfigModule,
    DrizzleModule,
    RedisModule,
    SettingsModule,
    BullModule.registerQueue({ name: IGDB_SYNC_QUEUE }),
  ],
  controllers: [IgdbController],
  providers: [IgdbService, IgdbSyncProcessor],
  exports: [IgdbService],
})
export class IgdbModule {}
