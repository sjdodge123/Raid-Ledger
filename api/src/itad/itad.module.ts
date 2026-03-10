import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ItadService } from './itad.service';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { RedisModule } from '../redis/redis.module';
import { SettingsModule } from '../settings/settings.module';
import { ITAD_QUEUE } from './itad.constants';

@Module({
  imports: [
    DrizzleModule,
    RedisModule,
    SettingsModule,
    BullModule.registerQueue({ name: ITAD_QUEUE }),
  ],
  providers: [ItadService],
  exports: [ItadService],
})
export class ItadModule {}
