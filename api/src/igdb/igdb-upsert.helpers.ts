import { Logger } from '@nestjs/common';
import { and, eq, inArray, isNull, not, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { GameDetailDto } from '@raid-ledger/contract';
import { IGDB_CONFIG, type IgdbApiGame } from './igdb.constants';
import { mapApiGameToDbRow, mapDbRowToDetail } from './igdb.mappers';

const logger = new Logger('IgdbUpsertHelpers');

/**
 * Build the conflict-update set for game upsert.
 * Uses COALESCE for twitchGameId/steamAppId so IGDB nulls
 * don't overwrite manually-set or seed values.
 */
function buildUpsertSet(row: ReturnType<typeof mapApiGameToDbRow>) {
  return {
    name: row.name,
    slug: row.slug,
    coverUrl: row.coverUrl,
    genres: row.genres,
    summary: row.summary,
    rating: row.rating,
    aggregatedRating: row.aggregatedRating,
    popularity: row.popularity,
    gameModes: row.gameModes,
    themes: row.themes,
    platforms: row.platforms,
    screenshots: row.screenshots,
    videos: row.videos,
    firstReleaseDate: row.firstReleaseDate,
    playerCount: row.playerCount,
    twitchGameId: row.twitchGameId ?? sql`${schema.games.twitchGameId}`,
    steamAppId: row.steamAppId ?? sql`${schema.games.steamAppId}`,
    crossplay: row.crossplay,
    cachedAt: new Date(),
  };
}

/**
 * Upsert a single game row into the database.
 * If a game with the same steamAppId already exists (e.g., from ITAD)
 * but has no igdbId, merge IGDB data into that row instead of inserting
 * a duplicate (ROK-986).
 */
export async function upsertSingleGameRow(
  db: PostgresJsDatabase<typeof schema>,
  row: ReturnType<typeof mapApiGameToDbRow>,
): Promise<void> {
  if (row.steamAppId && (await mergeBysteamAppId(db, row))) return;
  await db
    .insert(schema.games)
    .values(row)
    .onConflictDoUpdate({
      target: schema.games.igdbId,
      set: buildUpsertSet(row),
    });
}

/** Merge IGDB data into an existing ITAD-sourced game by steamAppId. */
async function mergeBysteamAppId(
  db: PostgresJsDatabase<typeof schema>,
  row: ReturnType<typeof mapApiGameToDbRow>,
): Promise<boolean> {
  const [existing] = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(
      and(
        eq(schema.games.steamAppId, row.steamAppId!),
        isNull(schema.games.igdbId),
      ),
    )
    .limit(1);
  if (!existing) return false;
  await db
    .update(schema.games)
    .set({
      ...buildUpsertSet(row),
      igdbId: row.igdbId,
      igdbEnrichmentStatus: 'enriched',
      igdbEnrichmentRetryCount: 0,
    })
    .where(eq(schema.games.id, existing.id));
  logger.log(
    `Merged IGDB ${row.igdbId} into existing game ${existing.id} by steamAppId`,
  );
  return true;
}

/** Filter out banned games from API results. */
async function filterBannedGames(
  db: PostgresJsDatabase<typeof schema>,
  apiGames: IgdbApiGame[],
): Promise<IgdbApiGame[]> {
  const incomingIgdbIds = apiGames.map((g) => g.id);
  const bannedRows = await db
    .select({ igdbId: schema.games.igdbId })
    .from(schema.games)
    .where(
      and(
        inArray(schema.games.igdbId, incomingIgdbIds),
        eq(schema.games.banned, true),
      ),
    );
  const bannedIgdbIds = new Set(bannedRows.map((r) => r.igdbId));
  return apiGames.filter((g) => !bannedIgdbIds.has(g.id));
}

/**
 * Upsert games from IGDB API responses into the local database.
 * Skips games whose igdbId is banned (tombstoned).
 * @param db - Database connection
 * @param apiGames - Raw IGDB API game objects
 * @returns Inserted/existing game rows as detail DTOs
 */
export async function upsertGamesFromApi(
  db: PostgresJsDatabase<typeof schema>,
  apiGames: IgdbApiGame[],
): Promise<GameDetailDto[]> {
  if (apiGames.length === 0) return [];

  const filteredGames = await filterBannedGames(db, apiGames);
  if (filteredGames.length === 0) return [];

  const rows = filteredGames.map((g) => mapApiGameToDbRow(g));
  for (const row of rows) {
    await upsertSingleGameRow(db, row);
  }

  const igdbIds = rows.map((r) => r.igdbId);
  const results = await db
    .select()
    .from(schema.games)
    .where(inArray(schema.games.igdbId, igdbIds));
  return results.map((g) => mapDbRowToDetail(g));
}

/** Fetch games with missing cover art from the database. */
async function fetchMissingCoverGames(db: PostgresJsDatabase<typeof schema>) {
  return db
    .select({ igdbId: schema.games.igdbId })
    .from(schema.games)
    .where(
      and(
        isNull(schema.games.coverUrl),
        not(isNull(schema.games.igdbId)),
        eq(schema.games.banned, false),
      ),
    );
}

/**
 * Backfill missing cover art from IGDB.
 * @param db - Database connection
 * @param queryIgdb - Function to query IGDB API
 * @returns Number of covers backfilled
 */
export async function backfillMissingCovers(
  db: PostgresJsDatabase<typeof schema>,
  queryIgdb: (body: string) => Promise<IgdbApiGame[]>,
): Promise<number> {
  const missingCovers = await fetchMissingCoverGames(db);
  if (missingCovers.length === 0) return 0;

  const ids = missingCovers.map((g) => g.igdbId).join(',');
  const coverResults = await queryIgdb(
    `fields id, cover.image_id; where id = (${ids}); limit ${missingCovers.length};`,
  );

  let backfilled = 0;
  for (const game of coverResults) {
    if (game.cover?.image_id) {
      const coverUrl = `${IGDB_CONFIG.COVER_URL_BASE}/${game.cover.image_id}.jpg`;
      await db
        .update(schema.games)
        .set({ coverUrl })
        .where(eq(schema.games.igdbId, game.id));
      backfilled++;
    }
  }

  if (backfilled > 0) {
    logger.log(`IGDB sync: backfilled cover art for ${backfilled} games`);
  }
  return backfilled;
}
