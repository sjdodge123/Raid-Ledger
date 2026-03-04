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
  async syncLibrary(userId: number): Promise<SteamSyncResultDto> {
    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });

    if (!user?.steamId) {
      throw new Error('User has no linked Steam account');
    }

    const apiKey = await this.settingsService.getSteamApiKey();
    if (!apiKey) {
      throw new Error('Steam API key is not configured');
    }

    // Check profile privacy
    const profile = await getPlayerSummary(apiKey, user.steamId);
    if (profile && profile.communityvisibilitystate !== 3) {
      this.logger.warn(
        `Steam profile for user ${userId} is private — skipping library sync`,
      );
      return { totalOwned: 0, matched: 0, newInterests: 0, updatedPlaytime: 0 };
    }

    // Fetch owned games from Steam
    const ownedGames = await getOwnedGames(apiKey, user.steamId);
    if (ownedGames.length === 0) {
      return { totalOwned: 0, matched: 0, newInterests: 0, updatedPlaytime: 0 };
    }

    // Get Steam AppIDs from owned games
    const steamAppIds = ownedGames.map((g) => g.appid);

    // Find matching games in our database by steam_app_id
    const matchedGames = await this.db
      .select({ id: schema.games.id, steamAppId: schema.games.steamAppId })
      .from(schema.games)
      .where(inArray(schema.games.steamAppId, steamAppIds));

    if (matchedGames.length === 0) {
      return {
        totalOwned: ownedGames.length,
        matched: 0,
        newInterests: 0,
        updatedPlaytime: 0,
      };
    }

    // Build lookup: steamAppId -> game row
    const gameByAppId = new Map(
      matchedGames.map((g) => [g.steamAppId!, g]),
    );

    // Get existing steam_library interests for this user
    const existingInterests = await this.db
      .select({
        gameId: schema.gameInterests.gameId,
        id: schema.gameInterests.id,
      })
      .from(schema.gameInterests)
      .where(
        and(
          eq(schema.gameInterests.userId, userId),
          eq(schema.gameInterests.source, 'steam_library'),
        ),
      );

    const existingGameIds = new Set(existingInterests.map((i) => i.gameId));
    const now = new Date();

    // Separate matched games into inserts vs updates
    const toInsert: {
      userId: number;
      gameId: number;
      source: string;
      playtimeForever: number;
      playtime2weeks: number | null;
      lastSyncedAt: Date;
    }[] = [];
    const toUpdate: {
      gameId: number;
      playtimeForever: number;
      playtime2weeks: number | null;
    }[] = [];

    for (const steamGame of ownedGames) {
      const dbGame = gameByAppId.get(steamGame.appid);
      if (!dbGame) continue;

      if (existingGameIds.has(dbGame.id)) {
        toUpdate.push({
          gameId: dbGame.id,
          playtimeForever: steamGame.playtime_forever,
          playtime2weeks: steamGame.playtime_2weeks ?? null,
        });
      } else {
        toInsert.push({
          userId,
          gameId: dbGame.id,
          source: 'steam_library',
          playtimeForever: steamGame.playtime_forever,
          playtime2weeks: steamGame.playtime_2weeks ?? null,
          lastSyncedAt: now,
        });
      }
    }

    // Batch insert new interests (use returning to get accurate count)
    let newInterests = 0;
    if (toInsert.length > 0) {
      const inserted = await this.db
        .insert(schema.gameInterests)
        .values(toInsert)
        .onConflictDoNothing()
        .returning({ id: schema.gameInterests.id });
      newInterests = inserted.length;
    }

    // Batch update playtime for existing interests
    let updatedPlaytime = 0;
    if (toUpdate.length > 0) {
      const updateGameIds = toUpdate.map((u) => u.gameId);
      const playtimeMap = new Map(
        toUpdate.map((u) => [u.gameId, u]),
      );

      // Build CASE expressions for batch update
      const foreverCases = toUpdate
        .map(
          (u) =>
            `WHEN game_id = ${u.gameId} THEN ${u.playtimeForever}`,
        )
        .join(' ');
      const weeksCases = toUpdate
        .map(
          (u) =>
            `WHEN game_id = ${u.gameId} THEN ${u.playtime2weeks === null ? 'NULL' : u.playtime2weeks}`,
        )
        .join(' ');

      const result = await this.db
        .update(schema.gameInterests)
        .set({
          playtimeForever: sql.raw(
            `CASE ${foreverCases} ELSE playtime_forever END`,
          ),
          playtime2weeks: sql.raw(
            `CASE ${weeksCases} ELSE playtime_2weeks END`,
          ),
          lastSyncedAt: now,
        })
        .where(
          and(
            eq(schema.gameInterests.userId, userId),
            inArray(schema.gameInterests.gameId, updateGameIds),
            eq(schema.gameInterests.source, 'steam_library'),
          ),
        )
        .returning({ id: schema.gameInterests.id });
      updatedPlaytime = result.length;
    }

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
