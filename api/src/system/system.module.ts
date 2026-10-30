import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { UsersModule } from '../users/users.module';
import { SettingsModule } from '../settings/settings.module';
import { SetupClaimModule } from '../setup-claim/setup-claim.module';

/**
 * System module (ROK-175, ROK-146).
 * Provides system status endpoint for first-run detection.
 * Now checks database for Discord OAuth configuration.
 */
@Module({
  imports: [UsersModule, SettingsModule, SetupClaimModule],
  controllers: [SystemController],
})
export class SystemModule {}
