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
 * - GET /admin/update-status — admin-only, returns update check results
 *   (ROK-1475: `updateAvailable` is feature-level; `fixesAvailable` is the
 *   build-level count of `fix:` commits the running build lacks).
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
      commitSha: process.env.COMMIT_SHA || null,
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
    const [
      latestVersion,
      lastChecked,
      updateAvailable,
      latestReleaseUrl,
      fixesAvailable,
      latestCommitSha,
      fixesCompareUrl,
    ] = await Promise.all([
      this.settingsService.get(SETTING_KEYS.LATEST_VERSION),
      this.settingsService.get(SETTING_KEYS.VERSION_CHECK_LAST_RUN),
      this.settingsService.get(SETTING_KEYS.UPDATE_AVAILABLE),
      this.settingsService.get(SETTING_KEYS.LATEST_RELEASE_URL),
      this.settingsService.get(SETTING_KEYS.FIXES_AVAILABLE),
      this.settingsService.get(SETTING_KEYS.LATEST_COMMIT_SHA),
      this.settingsService.get(SETTING_KEYS.FIXES_COMPARE_URL),
    ]);

    return {
      // ROK-1475: the semver, not the sha — `updateAvailable` is now the
      // feature-level signal and compares releases against this value.
      currentVersion: this.versionCheck.getVersion(),
      latestVersion,
      updateAvailable: updateAvailable === 'true',
      lastChecked,
      latestReleaseUrl: emptyToNull(latestReleaseUrl),
      fixesAvailable: parseCount(fixesAvailable),
      runningCommitSha: this.versionCheck.getRunningCommitSha(),
      latestCommitSha: emptyToNull(latestCommitSha),
      fixesCompareUrl: emptyToNull(fixesCompareUrl),
    };
  }
}

function emptyToNull(value: string | null): string | null {
  return value && value !== '' ? value : null;
}

/** '' / missing / garbage → null ("unknown"), never 0 ("checked, none"). */
export function parseCount(raw: string | null): number | null {
  if (raw == null || !/^\d+$/.test(raw)) return null;
  return Number.parseInt(raw, 10);
}
