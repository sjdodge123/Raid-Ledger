import { Module } from '@nestjs/common';
import { ItadService } from './itad.service';
import { ItadPriceService } from './itad-price.service';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { RedisModule } from '../redis/redis.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [DrizzleModule, RedisModule, SettingsModule],
  providers: [ItadService, ItadPriceService],
  exports: [ItadService, ItadPriceService],
})
export class ItadModule {}
