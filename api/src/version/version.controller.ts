import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { VersionCheckService } from './version-check.service';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import type { VersionInfoDto, UpdateStatusDto } from '@raid-ledger/contract';

/**
 * Version endpoints (ROK-294).
 *
 * - GET /system/version — public, returns current version and relay hub status.
 * - GET /admin/update-status — admin-only, returns update check results.
 */
@Controller()
export class VersionController {
  constructor(
    private readonly versionCheck: VersionCheckService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * GET /system/version
   * Public endpoint returning current app version and relay hub feature flag.
   */
  @Get('system/version')
  async getVersion(): Promise<VersionInfoDto> {
    const relayEnabled = await this.settingsService.get(
      SETTING_KEYS.RELAY_ENABLED,
    );

    return {
      version: this.versionCheck.getVersion(),
      relayHubEnabled: relayEnabled === 'true',
    };
  }

  /**
   * GET /admin/update-status
   * Admin-only endpoint returning version check results.
   */
  @Get('admin/update-status')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  async getUpdateStatus(): Promise<UpdateStatusDto> {
    const [latestVersion, lastChecked, updateAvailable] = await Promise.all([
      this.settingsService.get(SETTING_KEYS.LATEST_VERSION),
      this.settingsService.get(SETTING_KEYS.VERSION_CHECK_LAST_RUN),
      this.settingsService.get(SETTING_KEYS.UPDATE_AVAILABLE),
    ]);

    return {
      currentVersion: this.versionCheck.getVersion(),
      latestVersion,
      updateAvailable: updateAvailable === 'true',
      lastChecked,
    };
  }
}
