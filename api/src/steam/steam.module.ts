import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SteamAuthController } from './steam-auth.controller';
import { SteamService } from './steam.service';
import { SteamWishlistService } from './steam-wishlist.service';
import { SteamSyncProcessor } from './steam-sync.processor';
import { STEAM_SYNC_QUEUE } from './steam-sync.constants';
import { UsersModule } from '../users/users.module';
import { SettingsModule } from '../settings/settings.module';
import { IgdbModule } from '../igdb/igdb.module';
import { ItadModule } from '../itad/itad.module';
import { AuthModule } from '../auth/auth.module';

/**
 * Steam Integration Module (ROK-417)
 * Handles Steam OpenID 2.0 account linking, library sync, and scheduled sync.
 */
@Module({
  imports: [
    UsersModule,
    SettingsModule,
    IgdbModule,
    ItadModule,
    // ROK-1630: LinkNonceService for the GET /auth/steam/link?nonce= hop.
    AuthModule,
    BullModule.registerQueue({ name: STEAM_SYNC_QUEUE }),
  ],
  controllers: [SteamAuthController],
  providers: [SteamService, SteamWishlistService, SteamSyncProcessor],
  exports: [SteamService, SteamWishlistService],
})
export class SteamModule {}
