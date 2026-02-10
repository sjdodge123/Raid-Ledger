import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IgdbService } from './igdb.service';
import { IgdbController } from './igdb.controller';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { RedisModule } from '../redis/redis.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [ConfigModule, DrizzleModule, RedisModule, SettingsModule],
  controllers: [IgdbController],
  providers: [IgdbService],
  exports: [IgdbService],
})
export class IgdbModule {}
