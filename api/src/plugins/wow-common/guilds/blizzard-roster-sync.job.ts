import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { GuildBlizzardRosterSyncResult } from '@raid-ledger/contract';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { findHubGuild } from '../../../guilds/guild-core.queries';
import { SettingsService } from '../../../settings/settings.service';
import {
  FOREVER_ARMORY_OFF_MESSAGE,
  isForeverArmoryImportEnabled,
} from '../forever-armory-switch';
import { WOW_FOREVER_GAME_SLUG } from '../wow-forever-identity.helpers';
import {
  BlizzardRosterSyncService,
  type RosterSyncResult,
} from './blizzard-roster-sync.service';
import { isForeverGuildHub } from './guild-slug.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Guild ids whose Blizzard roster sync is running right now — shared by the
 * cron run and the manual "Sync now" route (409), ROK-1928 §C3.
 */
export const RUNNING_ROSTER_SYNCS = new Set<number>();

/** One cron run's outcome counts (summary log). */
export interface RosterSyncTally {
  ok: number;
  notFound: number;
  error: number;
  skipped: number;
}

/** The guild fields the manual route checks before syncing. */
export interface ManualSyncGuild {
  kind: schema.GuildSelect['kind'];
  gameSlug: string | null;
  guildSlug: string | null;
  blizzardRosterSyncedAt: Date | null;
}

/**
 * ROK-1928 §C — the 6-hourly Forever guild roster cron (`run`) and the manual
 * "Sync now" (`syncNow`), both over `BlizzardRosterSyncService`.
 */
@Injectable()
export class BlizzardRosterSyncJob {
  private readonly logger = new Logger(BlizzardRosterSyncJob.name);
  private isSyncing = false;

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly sync: BlizzardRosterSyncService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Cron handler: every due Forever guild, sequentially; one failure never
   * stops the loop. Kill switch read once per run.
   * @returns the tally, or null when skipped (overlap / switch off).
   */
  async run(): Promise<RosterSyncTally | null> {
    if (this.isSyncing) {
      this.logger.warn('Forever roster sync already in progress, skipping');
      return null;
    }
    this.isSyncing = true;
    try {
      if (!(await isForeverArmoryImportEnabled(this.settings))) {
        this.logger.log('Forever roster sync skipped: Armory import is off');
        return null;
      }
      const tally = await this.syncAll(await this.listDueGuildIds());
      this.logger.log(`Forever roster sync complete: ${JSON.stringify(tally)}`);
      return tally;
    } finally {
      this.isSyncing = false;
    }
  }

  /** Forever `wow_guild`s with a slug, not hidden, least-recently synced first. */
  async listDueGuildIds(): Promise<number[]> {
    const g = schema.guilds;
    const rows = await this.db
      .select({ id: g.id })
      .from(g)
      .innerJoin(schema.games, eq(schema.games.id, g.gameId))
      .where(
        and(
          isNotNull(g.guildSlug),
          eq(g.kind, 'wow_guild'),
          eq(schema.games.slug, WOW_FOREVER_GAME_SLUG),
          isNull(g.hiddenAt),
        ),
      )
      .orderBy(sql`${g.blizzardRosterSyncedAt} ASC NULLS FIRST`, g.id);
    return rows.map((r) => r.id);
  }

  /** Sequential loop; a throw was already reported by the service. */
  private async syncAll(ids: number[]): Promise<RosterSyncTally> {
    const tally: RosterSyncTally = { ok: 0, notFound: 0, error: 0, skipped: 0 };
    for (const id of ids) {
      if (RUNNING_ROSTER_SYNCS.has(id)) {
        tally.skipped += 1;
        continue;
      }
      try {
        const res = await this.withLock(id, () =>
          this.sync.syncForeverGuildRoster(id),
        );
        countResult(tally, res);
      } catch (err: unknown) {
        tally.error += 1;
        const msg = err instanceof Error ? err.message : 'Unknown error';
        this.logger.warn(`Forever roster sync of guild ${id} failed: ${msg}`);
      }
    }
    return tally;
  }

  /**
   * Manual "Sync now" for one guild.
   * @throws ForbiddenException kill switch off; NotFoundException not a
   *   Forever guild with a slug; ConflictException already running;
   *   BadGatewayException the Blizzard fetch/apply failed.
   */
  async syncNow(guildId: number): Promise<GuildBlizzardRosterSyncResult> {
    if (!(await isForeverArmoryImportEnabled(this.settings))) {
      throw new ForbiddenException(FOREVER_ARMORY_OFF_MESSAGE);
    }
    await this.assertSyncable(guildId);
    if (RUNNING_ROSTER_SYNCS.has(guildId)) {
      throw new ConflictException('A roster sync is already running');
    }
    const res = await this.withLock(guildId, () => this.runOne(guildId));
    if (res.status === 'disabled') {
      throw new ForbiddenException(FOREVER_ARMORY_OFF_MESSAGE);
    }
    if (res.status === 'skipped')
      throw new NotFoundException('Guild not found');
    const after = await this.readGuild(guildId);
    return {
      status: res.status,
      syncedAt: after?.blizzardRosterSyncedAt?.toISOString() ?? null,
      members: res.status === 'ok' ? res.updated + res.inserted : 0,
    };
  }

  /** The guild's kind, game and slug columns, or null when missing. */
  async readGuild(guildId: number): Promise<ManualSyncGuild | null> {
    const hub = await findHubGuild(this.db, guildId);
    if (!hub) return null;
    const { kind, guildSlug, blizzardRosterSyncedAt } = hub.guild;
    return { kind, gameSlug: hub.gameSlug, guildSlug, blizzardRosterSyncedAt };
  }

  /** 404 unless a Forever `wow_guild` with a Blizzard slug. */
  private async assertSyncable(guildId: number): Promise<void> {
    const g = await this.readGuild(guildId);
    const ok =
      g !== null &&
      isForeverGuildHub(g.kind, g.gameSlug) &&
      g.guildSlug !== null &&
      g.guildSlug !== '';
    if (!ok) throw new NotFoundException('No Blizzard guild slug is set');
  }

  /** Service call; its rethrow (already in Sentry) becomes a 502. */
  private async runOne(guildId: number): Promise<RosterSyncResult> {
    try {
      return await this.sync.syncForeverGuildRoster(guildId);
    } catch {
      throw new BadGatewayException('The Blizzard roster sync failed');
    }
  }

  /** Mark the guild running for the duration of `fn`. */
  private async withLock<T>(guildId: number, fn: () => Promise<T>): Promise<T> {
    RUNNING_ROSTER_SYNCS.add(guildId);
    try {
      return await fn();
    } finally {
      RUNNING_ROSTER_SYNCS.delete(guildId);
    }
  }
}

/** Bucket one service result into the tally. */
function countResult(tally: RosterSyncTally, res: RosterSyncResult): void {
  if (res.status === 'ok') tally.ok += 1;
  else if (res.status === 'not_found') tally.notFound += 1;
  else tally.skipped += 1;
}
