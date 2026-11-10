/**
 * Merge-target lookups for the IGDB upsert paths: which existing `games` row
 * an incoming IGDB row should merge into (by steamAppId, ROK-986/1024, or by
 * normalized name, ROK-1113). Split out of igdb-upsert.helpers.ts to keep it
 * inside the 300-line limit (ROK-2120). Read-only — callers hold the name lock.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { mapApiGameToDbRow } from './igdb.mappers';
import { findGameByNormalizedName } from './igdb-name-dedup.helpers';

type GameRow = ReturnType<typeof mapApiGameToDbRow>;

/**
 * Existing row whose canonical name matches (ROK-1113), or null. Skips a row
 * with a *different* non-null igdbId — IGDB ids are canonical, so a mismatch
 * signals a sequel/variant we should NOT collapse.
 */
export async function findByNormalizedName(
  tx: PostgresJsDatabase<typeof schema>,
  row: GameRow,
): Promise<number | null> {
  const match = await findGameByNormalizedName(tx, row.name);
  if (!match) return null;
  if (match.igdbId != null && match.igdbId !== row.igdbId) return null;
  return match.id;
}

/** Existing ITAD-sourced game (no igdbId) holding `steamAppId`, or null. */
export async function findBySteamAppId(
  tx: PostgresJsDatabase<typeof schema>,
  steamAppId: number,
): Promise<number | null> {
  const [existing] = await tx
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(
      and(eq(schema.games.steamAppId, steamAppId), isNull(schema.games.igdbId)),
    )
    .limit(1);
  return existing?.id ?? null;
}

/**
 * Batch pre-check: find existing ITAD-sourced game rows matching any of the
 * provided steamAppIds (no igdbId set). Returns a map of steamAppId -> row id
 * so the caller can merge instead of insert.
 * Replaces per-row SELECTs with ONE IN-clause SELECT (ROK-1024).
 */
export async function batchMergeBysteamAppId(
  db: PostgresJsDatabase<typeof schema>,
  steamAppIds: number[],
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (steamAppIds.length === 0) return map;
  const existing = await db
    .select({
      id: schema.games.id,
      steamAppId: schema.games.steamAppId,
    })
    .from(schema.games)
    .where(
      and(
        inArray(schema.games.steamAppId, steamAppIds),
        isNull(schema.games.igdbId),
      ),
    );
  for (const row of existing) {
    if (row.steamAppId != null) map.set(row.steamAppId, row.id);
  }
  return map;
}
