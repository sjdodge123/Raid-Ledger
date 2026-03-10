import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { eq, inArray, and, isNotNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SettingsService } from '../settings/settings.service';
import { IgdbService } from '../igdb/igdb.service';
import { ItadService } from '../itad/itad.service';
import { getOwnedGames, getPlayerSummary } from './steam-http.util';
import type { SteamOwnedGame } from './steam-http.util';
import {
  updateExistingPlaytime,
  type PlaytimeUpdateEntry,
} from './steam-playtime.helpers';
import {
  discoverGameViaItad,
  type DiscoveryDeps,
} from './steam-itad-discovery.helpers';
import type { SteamSyncResultDto } from '@raid-ledger/contract';

/**
 * Steam Library Sync Service (ROK-417, ROK-774).
 * Fetches owned games from Steam, discovers new games via ITAD,
 * enriches from IGDB, and populates game_interests.
 */
interface SteamClassifyCtx {
  gameByAppId: Map<number, { id: number }>;
  existingGameIds: Set<number>;
  userId: number;
  now: Date;
  toInsert: ReturnType<SteamService['buildInsertRow']>[];
  toUpdate: PlaytimeUpdateEntry[];
}

@Injectable()
export class SteamService {
  private readonly logger = new Logger(SteamService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
    @Optional() private readonly igdbService?: IgdbService,
    @Optional() private readonly itadService?: ItadService,
  ) {}

  /** Build a zero-result sync DTO. */
  private emptySyncResult(totalOwned: number, matched = 0): SteamSyncResultDto {
    return { totalOwned, matched, newInterests: 0, updatedPlaytime: 0 };
  }

  /**
   * Sync a user's Steam library to game_interests.
   * Pipeline: fetch owned → match DB → discover via ITAD → enrich IGDB → insert interests.
   */
  async syncLibrary(userId: number): Promise<SteamSyncResultDto> {
    const { apiKey, steamId } = await this.validateSyncPrereqs(userId);
    const ownedGames = await this.fetchOwnedGamesIfPublic(
      apiKey,
      steamId,
      userId,
    );
    if (ownedGames.length === 0) return this.emptySyncResult(0);

    // Phase 1: Match existing DB games
    const dbMatches = await this.findMatchingGames(ownedGames);
    const matchedAppIds = new Set(dbMatches.map((g) => g.steamAppId));

    // Phase 2: Discover unmatched games via ITAD
    const unmatched = ownedGames.filter((g) => !matchedAppIds.has(g.appid));
    const discovered = await this.discoverUnmatchedGames(unmatched);

    // Phase 3: Re-query all matches after discovery
    const allMatches = await this.findMatchingGames(ownedGames);
    if (allMatches.length === 0) return this.emptySyncResult(ownedGames.length);

    // Phase 4: Partition into insert/update and persist
    return this.persistInterests(userId, ownedGames, allMatches, discovered);
  }

  /** Discover unmatched Steam games via ITAD, returns count of discovered games. */
  private async discoverUnmatchedGames(
    unmatched: SteamOwnedGame[],
  ): Promise<number> {
    if (unmatched.length === 0 || !this.itadService) return 0;

    const deps = await this.buildDiscoveryDeps();
    if (!deps) return 0;

    let discovered = 0;
    for (const game of unmatched) {
      try {
        const result = await discoverGameViaItad(game.appid, deps);
        if (result) discovered++;
      } catch (err) {
        this.logger.warn(`ITAD discovery failed for appid ${game.appid}: ${err}`);
      }
    }

    if (discovered > 0) {
      this.logger.log(`ITAD discovery: ${discovered}/${unmatched.length} new`);
    }
    return discovered;
  }

  /** Build ITAD discovery dependencies from injected services. */
  private async buildDiscoveryDeps(): Promise<DiscoveryDeps | null> {
    if (!this.itadService) return null;
    const adultFilterEnabled =
      (await this.settingsService.get(SETTING_KEYS.IGDB_FILTER_ADULT)) ===
      'true';

    return {
      db: this.db,
      lookupBySteamAppId: (id) => this.itadService!.lookupBySteamAppId(id),
      queryIgdb: this.igdbService
        ? (body) => this.igdbService!.queryIgdb(body)
        : undefined,
      adultFilterEnabled,
    };
  }

  /** Persist game interests and return sync result DTO. */
  private async persistInterests(
    userId: number,
    ownedGames: SteamOwnedGame[],
    allMatches: { id: number; steamAppId: number | null }[],
    discovered: number,
  ): Promise<SteamSyncResultDto> {
    const { toInsert, toUpdate } = await this.partitionGames(
      userId,
      ownedGames,
      allMatches,
    );
    const newInterests = await this.insertNewInterests(toInsert);
    const updatedPlaytime = await updateExistingPlaytime(
      this.db,
      userId,
      toUpdate,
    );
    return this.buildSyncResult(
      ownedGames.length,
      allMatches.length,
      newInterests,
      updatedPlaytime,
      discovered > 0 ? discovered : undefined,
    );
  }

  /** Build the final sync result DTO with logging. */
  private buildSyncResult(
    totalOwned: number,
    matched: number,
    newInterests: number,
    updatedPlaytime: number,
    imported?: number,
  ): SteamSyncResultDto {
    this.logger.log(
      `Steam sync: ${totalOwned} owned, ${matched} matched, ` +
        `${newInterests} new, ${updatedPlaytime} updated` +
        (imported ? `, ${imported} imported` : ''),
    );
    return { totalOwned, matched, newInterests, updatedPlaytime, imported };
  }

  private async validateSyncPrereqs(
    userId: number,
  ): Promise<{ apiKey: string; steamId: string }> {
    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });
    if (!user?.steamId) throw new Error('User has no linked Steam account');
    const apiKey = await this.settingsService.getSteamApiKey();
    if (!apiKey) throw new Error('Steam API key is not configured');
    return { apiKey, steamId: user.steamId };
  }

  private async fetchOwnedGamesIfPublic(
    apiKey: string,
    steamId: string,
    userId: number,
  ): Promise<SteamOwnedGame[]> {
    const profile = await getPlayerSummary(apiKey, steamId);
    if (profile && profile.communityvisibilitystate !== 3) {
      this.logger.warn(
        `Steam profile for user ${userId} is private — skipping library sync`,
      );
      return [];
    }
    return getOwnedGames(apiKey, steamId);
  }

  private async findMatchingGames(
    ownedGames: SteamOwnedGame[],
  ): Promise<{ id: number; steamAppId: number | null }[]> {
    const steamAppIds = ownedGames.map((g) => g.appid);
    return this.db
      .select({ id: schema.games.id, steamAppId: schema.games.steamAppId })
      .from(schema.games)
      .where(inArray(schema.games.steamAppId, steamAppIds));
  }

  /** Fetch existing steam interest game IDs for a user. */
  private async fetchExistingSteamInterests(
    userId: number,
  ): Promise<Set<number>> {
    const rows = await this.db
      .select({ gameId: schema.gameInterests.gameId })
      .from(schema.gameInterests)
      .where(
        and(
          eq(schema.gameInterests.userId, userId),
          eq(schema.gameInterests.source, 'steam_library'),
        ),
      );
    return new Set(rows.map((i) => i.gameId));
  }

  /** Build a game interest insert row. */
  private buildInsertRow(
    userId: number,
    gameId: number,
    playtimeForever: number,
    playtime2weeks: number | null,
    now: Date,
  ) {
    return {
      userId,
      gameId,
      source: 'steam_library' as const,
      playtimeForever,
      playtime2weeks,
      lastSyncedAt: now,
    };
  }

  /** Build an update entry for an existing steam game interest. */
  private static buildUpdateEntry(
    gameId: number,
    playtimeForever: number,
    playtime2weeks: number | null,
  ) {
    return { gameId, playtimeForever, playtime2weeks };
  }

  /** Classify a single owned game as insert or update. */
  private classifySteamGame(
    steamGame: SteamOwnedGame,
    ctx: SteamClassifyCtx,
  ): void {
    const dbGame = ctx.gameByAppId.get(steamGame.appid);
    if (!dbGame) return;
    const pt2w = steamGame.playtime_2weeks ?? null;
    if (ctx.existingGameIds.has(dbGame.id))
      ctx.toUpdate.push(
        SteamService.buildUpdateEntry(
          dbGame.id,
          steamGame.playtime_forever,
          pt2w,
        ),
      );
    else
      ctx.toInsert.push(
        this.buildInsertRow(
          ctx.userId,
          dbGame.id,
          steamGame.playtime_forever,
          pt2w,
          ctx.now,
        ),
      );
  }

  private async partitionGames(
    userId: number,
    ownedGames: SteamOwnedGame[],
    matchedGames: { id: number; steamAppId: number | null }[],
  ) {
    const gameByAppId = new Map(matchedGames.map((g) => [g.steamAppId!, g]));
    const existingGameIds = await this.fetchExistingSteamInterests(userId);
    const now = new Date();
    const toInsert: ReturnType<SteamService['buildInsertRow']>[] = [];
    const toUpdate: PlaytimeUpdateEntry[] = [];
    const ctx: SteamClassifyCtx = {
      gameByAppId,
      existingGameIds,
      userId,
      now,
      toInsert,
      toUpdate,
    };
    for (const steamGame of ownedGames) this.classifySteamGame(steamGame, ctx);
    return { toInsert, toUpdate };
  }

  private async insertNewInterests(
    toInsert: {
      userId: number;
      gameId: number;
      source: string;
      playtimeForever: number;
      playtime2weeks: number | null;
      lastSyncedAt: Date;
    }[],
  ): Promise<number> {
    if (toInsert.length === 0) return 0;
    const inserted = await this.db
      .insert(schema.gameInterests)
      .values(toInsert)
      .onConflictDoNothing()
      .returning({ id: schema.gameInterests.id });
    return inserted.length;
  }

  /**
   * Sync all users who have linked Steam accounts.
   * Used by the scheduled cron job.
   */
  async syncAllLinkedUsers(): Promise<{
    usersProcessed: number;
    totalNewInterests: number;
  }> {
    const usersWithSteam = await this.db
      .select({ id: schema.users.id, steamId: schema.users.steamId })
      .from(schema.users)
      .where(isNotNull(schema.users.steamId));

    let usersProcessed = 0;
    let totalNewInterests = 0;

    for (const user of usersWithSteam) {
      try {
        const result = await this.syncLibrary(user.id);
        totalNewInterests += result.newInterests;
        usersProcessed++;
      } catch (error) {
        this.logger.warn(
          `Steam sync failed for user ${user.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }

      // Small delay between users to be nice to Steam API
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    this.logger.log(
      `Steam bulk sync: ${usersProcessed}/${usersWithSteam.length} users, ${totalNewInterests} new interests`,
    );

    return { usersProcessed, totalNewInterests };
  }
}
