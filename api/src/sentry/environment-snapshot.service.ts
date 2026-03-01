import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import * as os from 'os';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema';

interface EnvironmentSnapshot {
  integrations: {
    discordOAuth: boolean;
    discordBot: boolean;
    igdb: boolean;
    blizzard: boolean;
    github: boolean;
    relay: boolean;
  };
  migrations: Array<{ tag: string; appliedAt: string }>;
  settings: {
    demoMode: boolean;
    onboardingCompleted: boolean;
    defaultTimezone: string | null;
    communityName: string | null;
    relayEnabled: boolean;
    igdbFilterAdult: boolean;
    discordBotEnabled: boolean;
    discordBotSetupCompleted: boolean;
  };
  runtime: {
    nodeVersion: string;
    platform: string;
    arch: string;
    uptimeSeconds: number;
    memoryUsageMB: {
      rss: number;
      heapUsed: number;
      heapTotal: number;
    };
    isContainer: boolean;
  };
}

/** How long the snapshot cache is considered fresh (ms). */
const SNAPSHOT_CACHE_TTL_MS = 60_000;

@Injectable()
export class EnvironmentSnapshotService implements OnModuleInit {
  private readonly logger = new Logger(EnvironmentSnapshotService.name);

  private cachedSnapshot: EnvironmentSnapshot | null = null;
  private cacheTimestamp = 0;
  private collectPromise: Promise<EnvironmentSnapshot> | null = null;
  private migrationTableMissing = false;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private settingsService: SettingsService,
  ) {}

  onModuleInit(): void {
    Sentry.addEventProcessor((event) => {
      const snapshot = this.getCachedSnapshot();
      if (snapshot) {
        event.contexts = {
          ...event.contexts,
          integrations: snapshot.integrations,
          migrations: {
            recent: snapshot.migrations,
          },
          appSettings: snapshot.settings,
          runtime: snapshot.runtime,
        };
      }

      // Trigger async refresh for next error if cache is stale.
      // Fire-and-forget — does not block Sentry event processing.
      if (this.isCacheStale()) {
        this.collectSnapshot().catch((err: unknown) => {
          this.logger.warn('Failed to refresh environment snapshot', err);
        });
      }

      return event;
    });

    // Eagerly collect the first snapshot so it's available for early errors.
    this.collectSnapshot().catch((err: unknown) => {
      this.logger.warn('Failed initial environment snapshot collection', err);
    });
  }

  /**
   * Returns the cached snapshot synchronously (non-blocking).
   * Returns null if no snapshot has been collected yet.
   */
  getCachedSnapshot(): EnvironmentSnapshot | null {
    return this.cachedSnapshot;
  }

  /**
   * Collect and cache a fresh environment snapshot.
   * Coalesces concurrent callers so only one collection runs at a time.
   */
  async collectSnapshot(): Promise<EnvironmentSnapshot> {
    if (this.collectPromise) {
      return this.collectPromise;
    }

    this.collectPromise = this.doCollect();
    try {
      const snapshot = await this.collectPromise;
      this.cachedSnapshot = snapshot;
      this.cacheTimestamp = Date.now();
      return snapshot;
    } finally {
      this.collectPromise = null;
    }
  }

  private isCacheStale(): boolean {
    return Date.now() - this.cacheTimestamp >= SNAPSHOT_CACHE_TTL_MS;
  }

  private async doCollect(): Promise<EnvironmentSnapshot> {
    const [integrations, migrations, settings] = await Promise.all([
      this.collectIntegrationStatus(),
      this.collectMigrationHistory(),
      this.collectAppSettings(),
    ]);

    return {
      integrations,
      migrations,
      settings,
      runtime: this.collectRuntimeInfo(),
    };
  }

  private async collectIntegrationStatus(): Promise<
    EnvironmentSnapshot['integrations']
  > {
    const [discordOAuth, discordBot, igdb, blizzard, github, relay] =
      await Promise.all([
        this.settingsService.isDiscordConfigured(),
        this.settingsService.isDiscordBotConfigured(),
        this.settingsService.isIgdbConfigured(),
        this.settingsService.isBlizzardConfigured(),
        this.settingsService.isGitHubConfigured(),
        this.settingsService.exists(SETTING_KEYS.RELAY_ENABLED),
      ]);

    return { discordOAuth, discordBot, igdb, blizzard, github, relay };
  }

  private async collectMigrationHistory(): Promise<
    EnvironmentSnapshot['migrations']
  > {
    if (this.migrationTableMissing) {
      return [];
    }

    try {
      const rows = await this.db.execute<{ tag: string; created_at: string }>(
        sql`SELECT tag, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 10`,
      );

      return Array.from(rows).map((row) => ({
        tag: row.tag,
        appliedAt: row.created_at,
      }));
    } catch (err: unknown) {
      const isTableMissing =
        err instanceof Error &&
        'code' in err &&
        (err as Error & { code: string }).code === '42P01';

      if (isTableMissing) {
        this.logger.debug(
          '__drizzle_migrations table not found — skipping migration snapshot',
        );
        this.migrationTableMissing = true;
      } else {
        this.logger.warn('Failed to query migration history', err);
      }
      return [];
    }
  }

  private async collectAppSettings(): Promise<EnvironmentSnapshot['settings']> {
    const [
      demoMode,
      onboardingCompleted,
      defaultTimezone,
      communityName,
      relayEnabled,
      igdbFilterAdult,
      discordBotEnabled,
      discordBotSetupCompleted,
    ] = await Promise.all([
      this.settingsService.get(SETTING_KEYS.DEMO_MODE),
      this.settingsService.get(SETTING_KEYS.ONBOARDING_COMPLETED),
      this.settingsService.get(SETTING_KEYS.DEFAULT_TIMEZONE),
      this.settingsService.get(SETTING_KEYS.COMMUNITY_NAME),
      this.settingsService.get(SETTING_KEYS.RELAY_ENABLED),
      this.settingsService.get(SETTING_KEYS.IGDB_FILTER_ADULT),
      this.settingsService.get(SETTING_KEYS.DISCORD_BOT_ENABLED),
      this.settingsService.get(SETTING_KEYS.DISCORD_BOT_SETUP_COMPLETED),
    ]);

    return {
      demoMode: demoMode === 'true',
      onboardingCompleted: onboardingCompleted === 'true',
      defaultTimezone,
      communityName,
      relayEnabled: relayEnabled === 'true',
      igdbFilterAdult: igdbFilterAdult === 'true',
      discordBotEnabled: discordBotEnabled === 'true',
      discordBotSetupCompleted: discordBotSetupCompleted === 'true',
    };
  }

  private collectRuntimeInfo(): EnvironmentSnapshot['runtime'] {
    const mem = process.memoryUsage();

    return {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsageMB: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      },
      isContainer:
        os.hostname().length === 12 ||
        process.env.CONTAINER === 'true' ||
        process.env.DOCKER === 'true',
    };
  }
}
