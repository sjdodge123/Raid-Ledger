import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, inArray, and, isNotNull, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SettingsService } from '../settings/settings.service';
import { getOwnedGames, getPlayerSummary } from './steam-http.util';
import type { SteamSyncResultDto } from '@raid-ledger/contract';

/**
 * Steam Library Sync Service (ROK-417).
 * Fetches owned games from Steam, matches to IGDB records via steam_app_id,
 * and populates game_interests with source='steam_library'.
 */
interface SteamClassifyCtx {
  gameByAppId: Map<number, { id: number }>;
  existingGameIds: Set<number>;
  userId: number;
  now: Date;
  toInsert: ReturnType<SteamService['buildInsertRow']>[];
  toUpdate: Array<{
    gameId: number;
    playtimeForever: number;
    playtime2weeks: number | null;
  }>;
}

@Injectable()
export class SteamService {
  private readonly logger = new Logger(SteamService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Sync a user's Steam library to game_interests.
   * Returns sync stats (total owned, matched, new, updated).
   */
  /** Build a zero-result sync DTO. */
  private emptySyncResult(totalOwned: number, matched = 0): SteamSyncResultDto {
    return { totalOwned, matched, newInterests: 0, updatedPlaytime: 0 };
  }

  async syncLibrary(userId: number): Promise<SteamSyncResultDto> {
    const { apiKey, steamId } = await this.validateSyncPrereqs(userId);
    const ownedGames = await this.fetchOwnedGamesIfPublic(
      apiKey,
      steamId,
      userId,
    );
    if (ownedGames.length === 0) return this.emptySyncResult(0);
    const matchedGames = await this.findMatchingGames(ownedGames);
    if (matchedGames.length === 0)
      return this.emptySyncResult(ownedGames.length);
    const { toInsert, toUpdate } = await this.partitionGames(
      userId,
      ownedGames,
      matchedGames,
    );
    const newInterests = await this.insertNewInterests(toInsert);
    const updatedPlaytime = await this.updateExistingPlaytime(userId, toUpdate);
    this.logger.log(
      `Steam sync for user ${userId}: ${ownedGames.length} owned, ${matchedGames.length} matched, ${newInterests} new, ${updatedPlaytime} updated`,
    );
    return {
      totalOwned: ownedGames.length,
      matched: matchedGames.length,
      newInterests,
      updatedPlaytime,
    };
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
  ): Promise<Awaited<ReturnType<typeof getOwnedGames>>> {
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
    ownedGames: Awaited<ReturnType<typeof getOwnedGames>>,
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

  /** Row types for partition results. */
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
    steamGame: {
      appid: number;
      playtime_forever: number;
      playtime_2weeks?: number;
    },
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
    ownedGames: Awaited<ReturnType<typeof getOwnedGames>>,
    matchedGames: { id: number; steamAppId: number | null }[],
  ) {
    const gameByAppId = new Map(matchedGames.map((g) => [g.steamAppId!, g]));
    const existingGameIds = await this.fetchExistingSteamInterests(userId);
    const now = new Date();
    const toInsert: ReturnType<SteamService['buildInsertRow']>[] = [];
    const toUpdate: Array<{
      gameId: number;
      playtimeForever: number;
      playtime2weeks: number | null;
    }> = [];
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

  /** Build SQL CASE expressions for batch playtime update. */
  private buildPlaytimeCases(
    toUpdate: Array<{
      gameId: number;
      playtimeForever: number;
      playtime2weeks: number | null;
    }>,
  ) {
    const foreverCases = toUpdate
      .map((u) => `WHEN game_id = ${u.gameId} THEN ${u.playtimeForever}`)
      .join(' ');
    const weeksCases = toUpdate
      .map(
        (u) =>
          `WHEN game_id = ${u.gameId} THEN ${u.playtime2weeks === null ? 'NULL' : u.playtime2weeks}`,
      )
      .join(' ');
    return { foreverCases, weeksCases };
  }

  /** Build the SET clause for batch playtime updates. */
  private buildPlaytimeSetClause(
    toUpdate: Array<{
      gameId: number;
      playtimeForever: number;
      playtime2weeks: number | null;
    }>,
  ) {
    const { foreverCases, weeksCases } = this.buildPlaytimeCases(toUpdate);
    return {
      playtimeForever: sql.raw(
        `CASE ${foreverCases} ELSE playtime_forever END`,
      ),
      playtime2weeks: sql.raw(`CASE ${weeksCases} ELSE playtime_2weeks END`),
      lastSyncedAt: new Date(),
    };
  }

  private async updateExistingPlaytime(
    userId: number,
    toUpdate: Array<{
      gameId: number;
      playtimeForever: number;
      playtime2weeks: number | null;
    }>,
  ): Promise<number> {
    if (toUpdate.length === 0) return 0;
    const result = await this.db
      .update(schema.gameInterests)
      .set(this.buildPlaytimeSetClause(toUpdate))
      .where(
        and(
          eq(schema.gameInterests.userId, userId),
          inArray(
            schema.gameInterests.gameId,
            toUpdate.map((u) => u.gameId),
          ),
          eq(schema.gameInterests.source, 'steam_library'),
        ),
      )
      .returning({ id: schema.gameInterests.id });
    return result.length;
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
