/**
 * Database lookup helpers for Steam URL interest prompt (ROK-966).
 *
 * These helpers query the database to support the Steam link listener:
 * game resolution by Steam app ID, user lookup by Discord ID,
 * existing interest checks, and preference management.
 */
import { eq, and, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Find a game by its Steam app ID.
 *
 * @param db - Drizzle database instance
 * @param steamAppId - Steam store app ID
 * @returns Game with id and name, or null if not found
 */
export async function findGameBySteamAppId(
  db: Db,
  steamAppId: number,
): Promise<{ id: number; name: string } | null> {
  const [game] = await db
    .select({ id: schema.games.id, name: schema.games.name })
    .from(schema.games)
    .where(eq(schema.games.steamAppId, steamAppId))
    .limit(1);
  return game ?? null;
}

/**
 * Find a Raid Ledger user linked to a Discord account.
 *
 * @param db - Drizzle database instance
 * @param discordId - Discord user ID string
 * @returns User with id, or null if not linked
 */
export async function findLinkedRlUser(
  db: Db,
  discordId: string,
): Promise<{ id: number } | null> {
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.discordId, discordId))
    .limit(1);
  return user ?? null;
}

/** Sources that count as "hearted" — matches HEART_SOURCES in igdb-interest.helpers. */
const HEART_SOURCES = ['manual', 'discord', 'steam'];

/**
 * Check whether a user already has a heart interest for a game.
 * Only checks HEART_SOURCES — steam_wishlist/steam_library don't count.
 *
 * @param db - Drizzle database instance
 * @param userId - Raid Ledger user ID
 * @param gameId - Game ID
 * @returns true if a heart-source interest row exists
 */
export async function hasExistingHeartInterest(
  db: Db,
  userId: number,
  gameId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.gameInterests.id })
    .from(schema.gameInterests)
    .where(
      and(
        eq(schema.gameInterests.userId, userId),
        eq(schema.gameInterests.gameId, gameId),
        inArray(schema.gameInterests.source, HEART_SOURCES),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Check if a user has the auto-heart Steam URLs preference enabled.
 *
 * @param db - Drizzle database instance
 * @param userId - Raid Ledger user ID
 * @returns true if autoHeartSteamUrls is enabled
 */
export async function getAutoHeartSteamUrlsPref(
  db: Db,
  userId: number,
): Promise<boolean> {
  const [pref] = await db
    .select({
      key: schema.userPreferences.key,
      value: schema.userPreferences.value,
    })
    .from(schema.userPreferences)
    .where(
      and(
        eq(schema.userPreferences.userId, userId),
        eq(schema.userPreferences.key, 'autoHeartSteamUrls'),
      ),
    )
    .limit(1);
  return pref?.value === true;
}

/**
 * Add a game interest row with source 'discord'. Idempotent via onConflictDoNothing.
 *
 * @param db - Drizzle database instance
 * @param userId - Raid Ledger user ID
 * @param gameId - Game ID
 */
export async function addDiscordInterest(
  db: Db,
  userId: number,
  gameId: number,
): Promise<void> {
  await db
    .insert(schema.gameInterests)
    .values({ userId, gameId, source: 'discord' })
    .onConflictDoNothing();
}

/**
 * Upsert the autoHeartSteamUrls user preference.
 *
 * @param db - Drizzle database instance
 * @param userId - Raid Ledger user ID
 * @param enabled - Whether auto-heart is enabled
 */
export async function setAutoHeartSteamUrlsPref(
  db: Db,
  userId: number,
  enabled: boolean,
): Promise<void> {
  await db
    .insert(schema.userPreferences)
    .values({ userId, key: 'autoHeartSteamUrls', value: enabled })
    .onConflictDoUpdate({
      target: [schema.userPreferences.userId, schema.userPreferences.key],
      set: { value: enabled },
    });
}
