import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { CronJobService } from '../cron-jobs/cron-job.service';

interface GitHubRelease {
  tag_name: string;
}

/**
 * Scheduled service that checks GitHub for new Raid Ledger releases (ROK-294).
 *
 * - Runs once on startup (after 10s delay) and every 24 hours thereafter.
 * - Stores results in app_settings: latest_version, version_check_last_run, update_available.
 * - Handles GitHub API unreachability and rate limits gracefully.
 */
@Injectable()
export class VersionCheckService implements OnModuleInit {
  private readonly logger = new Logger(VersionCheckService.name);
  private readonly currentVersion: string;

  constructor(
    private readonly settingsService: SettingsService,
    private readonly cronJobService: CronJobService,
  ) {
    // Read version from package.json at startup — use process.cwd() so the
    // path resolves correctly both locally (cwd = api/) and in Docker (cwd = /app).
    const rootPkg = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { version: string };
    this.currentVersion = rootPkg.version;
  }

  onModuleInit() {
    // Run initial check after a short delay so it doesn't block startup
    setTimeout(() => {
      this.checkForUpdates().catch((err) => {
        this.logger.warn('Initial version check failed:', err);
      });
    }, 10_000);
  }

  /**
   * Get the running instance version.
   */
  getVersion(): string {
    return this.currentVersion;
  }

  /**
   * Cron: run every day at midnight.
   */
  @Cron('0 0 0 * * *', {
    name: 'VersionCheckService_handleCron',
  })
  async handleCron() {
    await this.cronJobService.executeWithTracking(
      'VersionCheckService_handleCron',
      async () => {
        await this.checkForUpdates();
      },
    );
  }

  /**
   * Check GitHub for the latest release and compare against current version.
   */
  async checkForUpdates(): Promise<void> {
    this.logger.debug('Checking for updates...');
    try {
      const latestVersion = await this.fetchLatestVersion();
      if (!latestVersion) {
        this.logger.debug('Could not determine latest version from GitHub');
        return;
      }
      const updateAvailable = this.isNewer(latestVersion, this.currentVersion);
      await this.storeVersionCheckResults(latestVersion, updateAvailable);
      this.logger.debug(
        `Version check complete: current=${this.currentVersion}, latest=${latestVersion}, updateAvailable=${updateAvailable}`,
      );
    } catch (error) {
      this.logger.warn(
        'Version check failed (will retry next cycle):',
        error instanceof Error ? error.message : error,
      );
    }
  }

  /** Persist version check results to app settings. */
  private async storeVersionCheckResults(
    latestVersion: string,
    updateAvailable: boolean,
  ): Promise<void> {
    await Promise.all([
      this.settingsService.set(SETTING_KEYS.LATEST_VERSION, latestVersion),
      this.settingsService.set(
        SETTING_KEYS.VERSION_CHECK_LAST_RUN,
        new Date().toISOString(),
      ),
      this.settingsService.set(
        SETTING_KEYS.UPDATE_AVAILABLE,
        updateAvailable ? 'true' : 'false',
      ),
    ]);
  }

  /**
   * Fetch the latest version string from GitHub releases, falling back to tags.
   */
  /** GitHub API headers for version checks. */
  private readonly githubHeaders: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'RaidLedger-VersionCheck',
  };

  private async fetchLatestVersion(): Promise<string | null> {
    try {
      const response = await fetch(
        'https://api.github.com/repos/sjdodge123/Raid-Ledger/releases/latest',
        { headers: this.githubHeaders, signal: AbortSignal.timeout(10_000) },
      );
      if (response.ok)
        return this.normalizeVersion(
          ((await response.json()) as GitHubRelease).tag_name,
        );
      if (response.status === 404)
        return this.fetchLatestTag(this.githubHeaders);
      if (response.status === 403 || response.status === 429) {
        this.logger.warn('GitHub API rate limited, skipping version check');
        return null;
      }
      this.logger.warn(`GitHub releases API returned ${response.status}`);
      return null;
    } catch (error) {
      this.logger.warn(
        'Failed to reach GitHub API:',
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  /**
   * Fallback: fetch latest tag if no releases exist.
   */
  private async fetchLatestTag(
    headers: Record<string, string>,
  ): Promise<string | null> {
    try {
      const response = await fetch(
        'https://api.github.com/repos/sjdodge123/Raid-Ledger/tags?per_page=1',
        { headers, signal: AbortSignal.timeout(10_000) },
      );

      if (!response.ok) return null;

      const tags = (await response.json()) as Array<{ name: string }>;
      if (tags.length === 0) return null;

      return this.normalizeVersion(tags[0].name);
    } catch {
      return null;
    }
  }

  /**
   * Strip leading 'v' from version strings for comparison.
   */
  private normalizeVersion(version: string): string {
    return version.replace(/^v/i, '');
  }

  /**
   * Simple semver comparison: returns true if remote > local.
   */
  private isNewer(remote: string, local: string): boolean {
    const remoteParts = remote.split('.').map(Number);
    const localParts = local.split('.').map(Number);

    for (let i = 0; i < Math.max(remoteParts.length, localParts.length); i++) {
      const r = remoteParts[i] ?? 0;
      const l = localParts[i] ?? 0;
      if (r > l) return true;
      if (r < l) return false;
    }

    return false;
  }
}
