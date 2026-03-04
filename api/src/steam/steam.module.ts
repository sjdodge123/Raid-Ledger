import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { SteamAuthController } from './steam-auth.controller';
import { SteamService } from './steam.service';
import { SteamSyncProcessor } from './steam-sync.processor';
import { STEAM_SYNC_QUEUE } from './steam-sync.constants';
import { UsersModule } from '../users/users.module';
import { SettingsModule } from '../settings/settings.module';

/**
 * Steam Integration Module (ROK-417)
 * Handles Steam OpenID 2.0 account linking, library sync, and scheduled sync.
 */
@Module({
  imports: [
    UsersModule,
    SettingsModule,
    BullModule.registerQueue({ name: STEAM_SYNC_QUEUE }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [SteamAuthController],
  providers: [SteamService, SteamSyncProcessor],
  exports: [SteamService],
})
export class SteamModule {}
