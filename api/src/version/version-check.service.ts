import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS, type SettingKey } from '../drizzle/schema/app-settings';
import { CronJobService } from '../cron-jobs/cron-job.service';
import {
  compareUrl,
  fetchCommit,
  fetchCompare,
  readCommitSha,
  shortSha,
} from './commit-freshness';
import { fetchLatestRelease, isNewer, normalizeVersion } from './release-check';

type FailedFetch =
  { kind: 'rate-limited' } | { kind: 'error'; status?: number };

/**
 * Scheduled service that checks whether the running build is out of date
 * (ROK-294, ROK-1393, ROK-1475).
 *
 * Two independent signals, both run every cycle (ROK-1475):
 * - FEATURE level (`update_available`): the latest GitHub release vs the
 *   running APP_VERSION (baked from the v* tag into every published image,
 *   package.json in local dev). Versions are cut only when a `feat:` lands,
 *   so this moves only when there is something new worth caring about.
 * - BUILD level (`fixes_available`), only when COMMIT_SHA is baked in: the
 *   number of `fix:` commits on main the running commit lacks, via the
 *   GitHub compare API.
 *
 * Each half writes only its own keys, and only on success — a failed half
 * (rate limit, network, air-gapped) keeps the previous values. Runs once on
 * startup (after 10 s) and daily at midnight.
 */
@Injectable()
export class VersionCheckService implements OnModuleInit {
  private readonly logger = new Logger(VersionCheckService.name);
  private readonly currentVersion: string;
  private readonly commitSha: string | null = readCommitSha();

  /** GitHub API headers for version checks. */
  private readonly githubHeaders: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'RaidLedger-VersionCheck',
  };

  constructor(
    private readonly settingsService: SettingsService,
    private readonly cronJobService: CronJobService,
  ) {
    // Prefer APP_VERSION, baked into the image at build time from the git
    // release tag (docker-publish.yml, and ci.yml's :main build since
    // ROK-1475) — it can't drift the way a hand-maintained package.json
    // field can. Fall back to package.json for local dev.
    this.currentVersion = process.env.APP_VERSION
      ? normalizeVersion(process.env.APP_VERSION)
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

  /** The running instance's semver (APP_VERSION or package.json). */
  getVersion(): string {
    return this.currentVersion;
  }

  /** Short COMMIT_SHA of the running build, or null when not baked in. */
  getRunningCommitSha(): string | null {
    return this.commitSha ? shortSha(this.commitSha) : null;
  }

  /** The short COMMIT_SHA when baked into the image, else the semver. */
  getRunningBuildLabel(): string {
    return this.getRunningCommitSha() ?? this.currentVersion;
  }

  /** Cron: run every day at midnight. */
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

  /** Run both halves; each is independently fallible (ROK-1475). */
  async checkForUpdates(): Promise<void> {
    this.logger.debug('Checking for updates...');
    const sha = this.commitSha;
    await Promise.all([
      this.runHalf(() => this.checkFeatureLevel()),
      sha ? this.runHalf(() => this.checkBuildLevel(sha)) : undefined,
    ]);
  }

  private async runHalf(check: () => Promise<void>): Promise<void> {
    try {
      await check();
    } catch (error) {
      this.logger.warn(
        'Version check failed (will retry next cycle):',
        error instanceof Error ? error.message : error,
      );
    }
  }

  /** Feature level: latest GitHub release vs the running semver. */
  private async checkFeatureLevel(): Promise<void> {
    const latest = await fetchLatestRelease(this.githubHeaders, this.logger);
    if (!latest) {
      this.logger.debug('Could not determine latest version from GitHub');
      return;
    }
    const updateAvailable = isNewer(latest.version, this.currentVersion);
    await this.storeSettings([
      [SETTING_KEYS.LATEST_VERSION, latest.version],
      [SETTING_KEYS.UPDATE_AVAILABLE, updateAvailable ? 'true' : 'false'],
      [SETTING_KEYS.LATEST_RELEASE_URL, latest.htmlUrl ?? ''],
    ]);
    this.logger.debug(
      `Feature check: current=${this.currentVersion}, latest=${latest.version}, updateAvailable=${updateAvailable}`,
    );
  }

  /** Build level: `fix:` commits on main that the running commit lacks. */
  private async checkBuildLevel(runningSha: string): Promise<void> {
    const main = await fetchCommit('main', this.githubHeaders);
    if (main.kind !== 'ok') return this.warnFetch('main', main);
    const mainSha = main.commit.sha;
    if (mainSha === runningSha) return this.storeBuildResult(0, mainSha, null);
    const cmp = await fetchCompare(runningSha, mainSha, this.githubHeaders);
    if (cmp.kind !== 'ok') {
      return this.warnFetch(`${shortSha(runningSha)}...main`, cmp);
    }
    await this.storeBuildResult(
      cmp.compare.fixCount,
      mainSha,
      compareUrl(runningSha, mainSha),
    );
    this.logger.debug(
      `Build check: running=${shortSha(runningSha)}, main=${shortSha(mainSha)}, ahead=${cmp.compare.aheadBy}, fixes=${cmp.compare.fixCount}`,
    );
  }

  private storeBuildResult(
    fixes: number,
    mainSha: string,
    url: string | null,
  ): Promise<void> {
    return this.storeSettings([
      [SETTING_KEYS.FIXES_AVAILABLE, String(fixes)],
      [SETTING_KEYS.LATEST_COMMIT_SHA, shortSha(mainSha)],
      [SETTING_KEYS.FIXES_COMPARE_URL, url ?? ''],
    ]);
  }

  private warnFetch(ref: string, result: FailedFetch): void {
    if (result.kind === 'rate-limited') {
      this.logger.warn('GitHub API rate limited, skipping version check');
    } else {
      this.logger.warn(
        `GitHub API failed for ${ref} (status ${result.status ?? 'n/a'}), skipping build check`,
      );
    }
  }

  /** Persist one half's results plus the shared last-run timestamp. */
  private async storeSettings(
    entries: Array<[SettingKey, string]>,
  ): Promise<void> {
    await Promise.all([
      ...entries.map(([key, value]) => this.settingsService.set(key, value)),
      this.settingsService.set(
        SETTING_KEYS.VERSION_CHECK_LAST_RUN,
        new Date().toISOString(),
      ),
    ]);
  }
}
