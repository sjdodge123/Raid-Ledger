import { Module } from '@nestjs/common';
import { VersionController } from './version.controller';
import { VersionCheckService } from './version-check.service';
import { SettingsModule } from '../settings/settings.module';

/**
 * Version module (ROK-294).
 * Provides version info endpoints and scheduled update checks.
 */
@Module({
  imports: [SettingsModule],
  controllers: [VersionController],
  providers: [VersionCheckService],
  exports: [VersionCheckService],
})
export class VersionModule {}
