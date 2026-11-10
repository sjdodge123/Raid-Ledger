/**
 * Unique-key owner lookups for the `games` write paths (ROK-2120).
 *
 * IGDB-first and ITAD/Steam-first copies of one title were never merged, so a
 * sync that writes `igdb_id` / `itad_game_id` / `slug` / `steam_app_id` onto
 * one row can collide with the twin that already holds it. Under postgres.js a
 * failed statement poisons the whole transaction (savepoints included), so a
 * collision must be PREVENTED: look up the current owner first, skip the
 * write, and report the pair for the dedup sweep. Never catch-and-retry.
 */
import { Logger } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

const logger = new Logger('GamesKeyOwner');

type Db = PostgresJsDatabase<typeof schema>;

/** Unique `games` columns a sync write can collide on. */
export type DuplicateKey = 'igdb_id' | 'slug' | 'steam_app_id' | 'itad_game_id';

/**
 * Log one skipped duplicate pair in the fixed, grep-able format the dedup
 * sweep keys on: `IGDB duplicate pair skipped: keep=<id> dup=<id> key=<col>`.
 * `keep` = the row that already holds the key; `dup` = the row the skipped
 * write targeted (or `igdb:<id>` when it would have been a fresh insert).
 */
export function reportDuplicatePair(
  keepId: number,
  dupId: number | string,
  key: DuplicateKey,
): void {
  logger.warn(
    `IGDB duplicate pair skipped: keep=${keepId} dup=${dupId} key=${key}`,
  );
}

/** Id of a row OTHER than `excludeId` holding `igdbId`, or null. */
export async function findOtherIgdbIdOwner(
  db: Db,
  igdbId: number,
  excludeId: number,
): Promise<number | null> {
  const rows = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(
      and(eq(schema.games.igdbId, igdbId), ne(schema.games.id, excludeId)),
    );
  return rows[0]?.id ?? null;
}

/** Id of a row OTHER than `excludeId` holding `itadGameId`, or null. */
export async function findOtherItadIdOwner(
  db: Db,
  itadGameId: string,
  excludeId: number,
): Promise<number | null> {
  const rows = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(
      and(
        eq(schema.games.itadGameId, itadGameId),
        ne(schema.games.id, excludeId),
      ),
    );
  return rows[0]?.id ?? null;
}
