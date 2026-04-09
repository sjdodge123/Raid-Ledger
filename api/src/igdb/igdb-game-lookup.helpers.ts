import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { IgdbGameDto, GameDetailDto } from '@raid-ledger/contract';
import { mapDbRowToDetail } from './igdb.mappers';

/**
 * Look up a game by ID and return a lightweight DTO.
 * @param db - Database connection
 * @param id - Game ID
 * @returns IgdbGameDto or null if not found
 */
export async function lookupGameById(
  db: PostgresJsDatabase<typeof schema>,
  id: number,
): Promise<IgdbGameDto | null> {
  const r = await db
    .select()
    .from(schema.games)
    .where(eq(schema.games.id, id))
    .limit(1);
  if (r.length === 0) return null;
  return {
    id: r[0].id,
    igdbId: r[0].igdbId,
    name: r[0].name,
    slug: r[0].slug,
    coverUrl: r[0].coverUrl,
  };
}

/**
 * Look up a game by ID and return a full detail DTO.
 * @param db - Database connection
 * @param id - Game ID
 * @returns GameDetailDto or null if not found
 */
export async function lookupGameDetailById(
  db: PostgresJsDatabase<typeof schema>,
  id: number,
): Promise<GameDetailDto | null> {
  const r = await db
    .select()
    .from(schema.games)
    .where(eq(schema.games.id, id))
    .limit(1);
  return r.length === 0 ? null : mapDbRowToDetail(r[0]);
}

/**
 * Look up a game by Steam App ID (ROK-945).
 * Excludes hidden and banned games.
 * @param db - Database connection
 * @param steamAppId - Steam store application ID
 * @returns IgdbGameDto or null if not found
 */
export async function lookupGameBySteamAppId(
  db: PostgresJsDatabase<typeof schema>,
  steamAppId: number,
): Promise<IgdbGameDto | null> {
  const r = await db
    .select()
    .from(schema.games)
    .where(
      and(
        eq(schema.games.steamAppId, steamAppId),
        eq(schema.games.hidden, false),
        eq(schema.games.banned, false),
      ),
    )
    .limit(1);
  if (r.length === 0) return null;
  return {
    id: r[0].id,
    igdbId: r[0].igdbId,
    name: r[0].name,
    slug: r[0].slug,
    coverUrl: r[0].coverUrl,
  };
}
