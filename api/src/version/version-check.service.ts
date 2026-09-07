import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { CronJobService } from '../cron-jobs/cron-job.service';
import {
  compareUrl,
  fetchCommit,
  isBehindMain,
  readCommitSha,
  shortSha,
} from './commit-freshness';

interface GitHubRelease {
  tag_name: string;
  html_url: string;
}

interface LatestRelease {
  version: string;
  htmlUrl: string | null;
}

interface CheckResult {
  latestVersion: string;
  updateAvailable: boolean;
  url: string | null;
}

/**
 * Scheduled service that checks whether the running build is out of date
 * (ROK-294, ROK-1393).
 *
 * Two modes:
 * - COMMIT_SHA set (every image built from `main` by ci.yml docker-build):
 *   compare the running commit against origin/main's head via the GitHub
 *   commits API. "Out of date" = main's head is more than 30 h newer than
 *   the running commit (daily Watchtower window + slack).
 * - COMMIT_SHA unset (local dev): compare APP_VERSION / package.json
 *   against the latest GitHub release via semver.
 *
 * - Runs once on startup (after 10s delay) and every 24 hours thereafter.
 * - Stores results in app_settings: latest_version, version_check_last_run,
 *   update_available, latest_release_url.
 * - Handles GitHub API unreachability and rate limits gracefully (warn,
 *   skip, keep the previous result).
 */
@Injectable()
export class VersionCheckService implements OnModuleInit {
  private readonly logger = new Logger(VersionCheckService.name);
  private readonly currentVersion: string;
  private readonly commitSha: string | null = readCommitSha();

  constructor(
    private readonly settingsService: SettingsService,
    private readonly cronJobService: CronJobService,
  ) {
    // Prefer APP_VERSION, baked into the image at build time from the git
    // release tag (see docker-publish.yml / Dockerfile.allinone) — this can't
    // drift the way a hand-maintained package.json field can. Fall back to
    // reading package.json for local dev, where APP_VERSION isn't set.
    this.currentVersion = process.env.APP_VERSION
      ? this.normalizeVersion(process.env.APP_VERSION)
      : (
          JSON.parse(
            readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
          ) as { version: string }
        ).version;
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
   * Label for the running build as shown by GET /admin/update-status:
   * the short COMMIT_SHA when baked into the image, else the semver.
   */
  getRunningBuildLabel(): string {
    return this.commitSha ? shortSha(this.commitSha) : this.currentVersion;
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
   * Check GitHub and persist whether the running build is out of date.
   */
  async checkForUpdates(): Promise<void> {
    this.logger.debug('Checking for updates...');
    try {
      const result = this.commitSha
        ? await this.compareAgainstMain(this.commitSha)
        : await this.compareAgainstRelease();
      if (!result) return;
      await this.storeVersionCheckResults(
        result.latestVersion,
        result.updateAvailable,
        result.url,
      );
      this.logger.debug(
        `Version check complete: current=${this.getRunningBuildLabel()}, latest=${result.latestVersion}, updateAvailable=${result.updateAvailable}`,
      );
    } catch (error) {
      this.logger.warn(
        'Version check failed (will retry next cycle):',
        error instanceof Error ? error.message : error,
      );
    }
  }

  /** Semver fallback (COMMIT_SHA unset): latest release vs current version. */
  private async compareAgainstRelease(): Promise<CheckResult | null> {
    const latest = await this.fetchLatestRelease();
    if (!latest) {
      this.logger.debug('Could not determine latest version from GitHub');
      return null;
    }
    return {
      latestVersion: latest.version,
      updateAvailable: this.isNewer(latest.version, this.currentVersion),
      url: latest.htmlUrl,
    };
  }

  /** Commit mode: running COMMIT_SHA vs origin/main head (ROK-1393). */
  private async compareAgainstMain(
    runningSha: string,
  ): Promise<CheckResult | null> {
    const main = await fetchCommit('main', this.githubHeaders);
    if (main.kind !== 'ok') return this.warnCommitFetch('main', main);
    if (main.commit.sha === runningSha) {
      return {
        latestVersion: shortSha(main.commit.sha),
        updateAvailable: false,
        url: null,
      };
    }
    const running = await fetchCommit(runningSha, this.githubHeaders);
    if (running.kind !== 'ok') {
      return this.warnCommitFetch(shortSha(runningSha), running);
    }
    return {
      latestVersion: shortSha(main.commit.sha),
      updateAvailable: isBehindMain(running.commit, main.commit),
      url: compareUrl(runningSha, main.commit.sha),
    };
  }

  private warnCommitFetch(
    ref: string,
    result: { kind: 'rate-limited' } | { kind: 'error'; status?: number },
  ): null {
    if (result.kind === 'rate-limited') {
      this.logger.warn('GitHub API rate limited, skipping version check');
    } else {
      this.logger.warn(
        `GitHub commits API failed for ${ref} (status ${result.status ?? 'n/a'}), skipping version check`,
      );
    }
    return null;
  }

  /** Persist version check results to app settings. */
  private async storeVersionCheckResults(
    latestVersion: string,
    updateAvailable: boolean,
    latestReleaseUrl: string | null,
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
      this.settingsService.set(
        SETTING_KEYS.LATEST_RELEASE_URL,
        latestReleaseUrl ?? '',
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

  private async fetchLatestRelease(): Promise<LatestRelease | null> {
    try {
      const response = await fetch(
        'https://api.github.com/repos/sjdodge123/Raid-Ledger/releases/latest',
        { headers: this.githubHeaders, signal: AbortSignal.timeout(10_000) },
      );
      if (response.ok) {
        const body = (await response.json()) as GitHubRelease;
        return {
          version: this.normalizeVersion(body.tag_name),
          htmlUrl: body.html_url ?? null,
        };
      }
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
   * Fallback: fetch latest tag if no releases exist. Tags have no
   * per-release html_url, so we return `htmlUrl: null` and let the UI
   * fall back to the generic /releases index.
   */
  private async fetchLatestTag(
    headers: Record<string, string>,
  ): Promise<LatestRelease | null> {
    try {
      const response = await fetch(
        'https://api.github.com/repos/sjdodge123/Raid-Ledger/tags?per_page=1',
        { headers, signal: AbortSignal.timeout(10_000) },
      );

      if (!response.ok) return null;

      const tags = (await response.json()) as Array<{ name: string }>;
      if (tags.length === 0) return null;

      return { version: this.normalizeVersion(tags[0].name), htmlUrl: null };
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
