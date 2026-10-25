import { Inject, Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../../../settings/settings.service';
import {
  getGlobalAchievementPercentages,
  getPlayerAchievements,
  getSchemaForGame,
} from '../../../steam/steam-achievements-http.util';
import {
  STEAM_STATS_RUN_LIMITS,
  SteamRateLimitedError,
  type SteamStatsRunLimits,
} from './steam-stats.constants';
import { SteamStatsStorageRepository } from './steam-stats-storage.repository';
import {
  SteamStatsTargetsRepository,
  type SteamStatsTarget,
} from './steam-stats-targets.repository';

/** What one refresh run did. */
export interface SteamStatsRunSummary {
  apps: number;
  userFetches: number;
  capped: boolean;
}

/**
 * ROK-1953 D5/D6 — fetches Steam achievements for members of live game hubs
 * whose app is enabled. Per app: schema + global % (a failed schema keeps
 * old rows and skips that app's users). Per user: one call, bounded by the
 * run ceiling, `delayMs` apart, oldest-fetched first. The first 429 throws
 * {@link SteamRateLimitedError} so BullMQ retries later; any other per-user
 * failure is logged (user id only — never the SteamID) and the run goes on.
 */
@Injectable()
export class SteamStatsRefreshService {
  private readonly logger = new Logger(SteamStatsRefreshService.name);

  constructor(
    private readonly targets: SteamStatsTargetsRepository,
    private readonly storage: SteamStatsStorageRepository,
    private readonly settings: SettingsService,
    @Inject(STEAM_STATS_RUN_LIMITS)
    private readonly limits: SteamStatsRunLimits,
  ) {}

  /** The nightly run over every enabled app with a live hub. */
  async refreshAll(): Promise<SteamStatsRunSummary> {
    const run: SteamStatsRunSummary = {
      apps: 0,
      userFetches: 0,
      capped: false,
    };
    const key = await this.settings.getSteamApiKey();
    if (!key) return run;
    for (const [appId, guildIds] of await this.targets.liveHubsByApp()) {
      run.apps++;
      if (!(await this.refreshSchema(key, appId))) continue;
      const users = await this.targets.targetsFor(appId, guildIds);
      if (!(await this.refreshUsers(key, appId, users, run))) break;
    }
    if (run.capped) {
      this.logger.warn(
        `Steam stats run hit the ${this.limits.maxUserFetches}-fetch ceiling after ${run.apps} app(s); the rest resume next run`,
      );
    }
    return run;
  }

  /** D6: one user right after linking Steam, for apps whose schema is stored `ok`. */
  async refreshUser(userId: number): Promise<SteamStatsRunSummary> {
    const run: SteamStatsRunSummary = {
      apps: 0,
      userFetches: 0,
      capped: false,
    };
    const key = await this.settings.getSteamApiKey();
    if (!key) return run;
    for (const [appId, guildIds] of await this.targets.liveHubsByApp()) {
      if ((await this.storage.schemaStatus(appId)) !== 'ok') continue;
      run.apps++;
      const users = await this.targets.targetsFor(appId, guildIds, userId);
      if (!(await this.refreshUsers(key, appId, users, run))) break;
    }
    return run;
  }

  /** Schema + global %; true when the app has achievements to fetch users for. */
  private async refreshSchema(key: string, appId: number): Promise<boolean> {
    const schema = await getSchemaForGame(key, appId);
    if (schema.kind === 'rate_limited') throw new SteamRateLimitedError(appId);
    if (schema.kind === 'error') {
      this.logger.warn(
        `Steam schema fetch failed for app ${appId} (HTTP ${schema.status})`,
      );
      await this.storage.markSchemaError(appId, new Date());
      return false;
    }
    if (schema.missingHidden > 0) {
      this.logger.warn(
        `Steam schema for app ${appId}: ${schema.missingHidden} achievement(s) lack "hidden" — masked (OQ5)`,
      );
    }
    const pct = await getGlobalAchievementPercentages(appId);
    if (pct.kind === 'rate_limited') throw new SteamRateLimitedError(appId);
    const map = pct.kind === 'ok' ? pct.percentages : null;
    await this.storage.saveSchema(appId, schema.achievements, map, new Date());
    return schema.achievements.length > 0;
  }

  /** False once the run ceiling is reached (the caller stops). */
  private async refreshUsers(
    key: string,
    appId: number,
    users: readonly SteamStatsTarget[],
    run: SteamStatsRunSummary,
  ): Promise<boolean> {
    for (const user of users) {
      if (run.userFetches >= this.limits.maxUserFetches) {
        run.capped = true;
        return false;
      }
      run.userFetches++;
      await this.refreshOne(key, appId, user);
      await delay(this.limits.delayMs);
    }
    return true;
  }

  private async refreshOne(
    key: string,
    appId: number,
    user: SteamStatsTarget,
  ): Promise<void> {
    try {
      const r = await getPlayerAchievements(key, user.steamId, appId);
      if (r.kind === 'rate_limited') throw new SteamRateLimitedError(appId);
      const now = new Date();
      if (r.kind === 'ok') {
        await this.storage.saveUserOk(user.userId, appId, r.unlocked, now);
      } else {
        await this.storage.saveUserStatus(user.userId, appId, r.kind, now);
      }
    } catch (err: unknown) {
      if (err instanceof SteamRateLimitedError) throw err;
      const reason = err instanceof Error ? err.name : 'unknown';
      this.logger.warn(
        `Steam stats fetch failed for user ${user.userId}, app ${appId} (${reason})`,
      );
    }
  }
}

/** Pause between users; 0 resolves at once (specs). */
function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
