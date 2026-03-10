/**
 * Steam Wishlist Sync Service (ROK-418).
 * Fetches wishlist from Steam, matches to IGDB records via steam_app_id,
 * and populates game_interests with source='steam_wishlist'.
 */
import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { eq, inArray, and, isNotNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SettingsService } from '../settings/settings.service';
import { IgdbService } from '../igdb/igdb.service';
import { ItadService } from '../itad/itad.service';
import { getWishlist, getPlayerSummary } from './steam-http.util';
import {
  discoverGameViaItad,
  type DiscoveryDeps,
} from './steam-itad-discovery.helpers';
import {
  computeWishlistDiff,
  fetchExistingWishlistIds,
} from './steam-wishlist.helpers';
import type { SteamWishlistSyncResultDto } from '@raid-ledger/contract';
import type { SteamWishlistItem } from './steam-http.util';

@Injectable()
export class SteamWishlistService {
  private readonly logger = new Logger(SteamWishlistService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
    @Optional() private readonly igdbService?: IgdbService,
    @Optional() private readonly itadService?: ItadService,
  ) {}

  /** Build a zero-result sync DTO. */
  private emptyResult(): SteamWishlistSyncResultDto {
    return { totalWishlisted: 0, matched: 0, newInterests: 0, removed: 0 };
  }

  /**
   * Sync a user's Steam wishlist to game_interests.
   * Adds new entries and removes ones no longer wishlisted.
   */
  async syncWishlist(userId: number): Promise<SteamWishlistSyncResultDto> {
    const { apiKey, steamId } = await this.validatePrereqs(userId);
    const profile = await getPlayerSummary(apiKey, steamId);
    if (profile && profile.communityvisibilitystate !== 3) {
      this.logger.warn(
        `Steam profile for user ${userId} is private — skipping wishlist sync`,
      );
      return this.emptyResult();
    }
    const items = await getWishlist(apiKey, steamId);
    if (items.length === 0) {
      return this.handleEmptyWishlist(userId);
    }
    return this.processWishlistItems(userId, items);
  }

  /** Validate user has Steam linked and API key exists. */
  private async validatePrereqs(
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

  /** Handle case when wishlist is empty (still remove stale entries). */
  private async handleEmptyWishlist(
    userId: number,
  ): Promise<SteamWishlistSyncResultDto> {
    const existingIds = await fetchExistingWishlistIds(this.db, userId, schema);
    if (existingIds.size === 0) return this.emptyResult();
    const removed = await this.removeWishlistEntries(userId, [...existingIds]);
    return { totalWishlisted: 0, matched: 0, newInterests: 0, removed };
  }

  /** Process non-empty wishlist: match, backfill, diff, persist. */
  private async processWishlistItems(
    userId: number,
    items: SteamWishlistItem[],
  ): Promise<SteamWishlistSyncResultDto> {
    const { matchedGames, imported } = await this.matchWithBackfill(items);
    const existingIds = await fetchExistingWishlistIds(this.db, userId, schema);
    const diff = computeWishlistDiff({
      steamItems: items,
      matchedGames,
      existingGameIds: existingIds,
      userId,
    });
    const newInterests = await this.insertWishlistEntries(diff.toInsert);
    const removed = await this.removeWishlistEntries(
      userId,
      diff.toRemoveGameIds,
    );
    return this.buildResult(
      items.length,
      matchedGames.length,
      newInterests,
      removed,
      imported > 0 ? imported : undefined,
    );
  }

  /** Match wishlist items to DB games, discovering unmatched via ITAD. */
  private async matchWithBackfill(items: SteamWishlistItem[]) {
    let matchedGames = await this.findMatchingGames(items);
    const imported = await this.discoverUnmatched(items, matchedGames);
    if (imported > 0) matchedGames = await this.findMatchingGames(items);
    return { matchedGames, imported };
  }

  /** Discover unmatched wishlist games via ITAD. */
  private async discoverUnmatched(
    items: SteamWishlistItem[],
    matchedGames: { id: number; steamAppId: number | null }[],
  ): Promise<number> {
    if (!this.itadService) return 0;
    const deps = await this.buildDiscoveryDeps();
    if (!deps) return 0;
    const matchedAppIds = new Set(matchedGames.map((g) => g.steamAppId));
    const unmatched = items.filter((i) => !matchedAppIds.has(i.appid));
    if (unmatched.length === 0) return 0;

    let discovered = 0;
    for (const item of unmatched) {
      try {
        const result = await discoverGameViaItad(item.appid, deps);
        if (result) discovered++;
      } catch (err) {
        this.logger.warn(`ITAD wishlist discovery failed for ${item.appid}: ${err}`);
      }
    }
    if (discovered > 0) {
      this.logger.log(`ITAD wishlist discovery: ${discovered}/${unmatched.length} new`);
    }
    return discovered;
  }

  /** Build ITAD discovery dependencies. */
  private async buildDiscoveryDeps(): Promise<DiscoveryDeps | null> {
    if (!this.itadService) return null;
    const adultFilterEnabled =
      (await this.settingsService.get(SETTING_KEYS.IGDB_FILTER_ADULT)) === 'true';
    return {
      db: this.db,
      lookupBySteamAppId: (id) => this.itadService!.lookupBySteamAppId(id),
      queryIgdb: this.igdbService
        ? (body) => this.igdbService!.queryIgdb(body)
        : undefined,
      adultFilterEnabled,
    };
  }

  /** Find games in DB matching Steam AppIDs. */
  private async findMatchingGames(
    items: SteamWishlistItem[],
  ): Promise<{ id: number; steamAppId: number | null }[]> {
    const appIds = items.map((i) => i.appid);
    return this.db
      .select({ id: schema.games.id, steamAppId: schema.games.steamAppId })
      .from(schema.games)
      .where(inArray(schema.games.steamAppId, appIds));
  }

  /** Insert new wishlist entries. Returns count inserted. */
  private async insertWishlistEntries(
    toInsert: {
      userId: number;
      gameId: number;
      source: 'steam_wishlist';
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

  /** Remove wishlist entries for games no longer wishlisted. */
  private async removeWishlistEntries(
    userId: number,
    gameIds: number[],
  ): Promise<number> {
    if (gameIds.length === 0) return 0;
    const deleted = await this.db
      .delete(schema.gameInterests)
      .where(
        and(
          eq(schema.gameInterests.userId, userId),
          eq(schema.gameInterests.source, 'steam_wishlist'),
          inArray(schema.gameInterests.gameId, gameIds),
        ),
      )
      .returning({ id: schema.gameInterests.id });
    return deleted.length;
  }

  /** Build the final sync result DTO with logging. */
  private buildResult(
    totalWishlisted: number,
    matched: number,
    newInterests: number,
    removed: number,
    imported?: number,
  ): SteamWishlistSyncResultDto {
    this.logger.log(
      `Wishlist sync: ${totalWishlisted} wishlisted, ${matched} matched, ${newInterests} new, ${removed} removed` +
        (imported ? `, ${imported} imported` : ''),
    );
    return { totalWishlisted, matched, newInterests, removed, imported };
  }

  /**
   * Sync wishlist for all linked Steam users (used by cron).
   */
  async syncAllLinkedUsersWishlist(): Promise<{
    usersProcessed: number;
    totalNewInterests: number;
  }> {
    const users = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(isNotNull(schema.users.steamId));
    return this.processBulkSync(users);
  }

  /** Process bulk sync for a list of users. */
  private async processBulkSync(
    users: { id: number }[],
  ): Promise<{ usersProcessed: number; totalNewInterests: number }> {
    let usersProcessed = 0;
    let totalNewInterests = 0;
    for (const user of users) {
      try {
        const result = await this.syncWishlist(user.id);
        totalNewInterests += result.newInterests;
        usersProcessed++;
      } catch (error) {
        this.logger.warn(
          `Wishlist sync failed for user ${user.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    this.logger.log(
      `Wishlist bulk sync: ${usersProcessed} users, ${totalNewInterests} new interests`,
    );
    return { usersProcessed, totalNewInterests };
  }
}
