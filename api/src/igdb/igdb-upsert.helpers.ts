import { Logger } from '@nestjs/common';
import { and, eq, inArray, isNull, not, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { GameDetailDto } from '@raid-ledger/contract';
import { IGDB_CONFIG, type IgdbApiGame } from './igdb.constants';
import { mapApiGameToDbRow, mapDbRowToDetail } from './igdb.mappers';

const logger = new Logger('IgdbUpsertHelpers');

/**
 * Build the conflict-update set for a single-row game upsert.
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
 * Build the conflict-update set for a BATCH game upsert (ROK-1024).
 * Each field references `excluded.<column>` — the per-row value from the
 * INSERT. For twitchGameId/steamAppId, COALESCE preserves the existing
 * value when the incoming row has null, mirroring the single-row semantics.
 */
function buildBatchUpsertSet() {
  return {
    name: sql`excluded.name`,
    slug: sql`excluded.slug`,
    coverUrl: sql`excluded.cover_url`,
    genres: sql`excluded.genres`,
    summary: sql`excluded.summary`,
    rating: sql`excluded.rating`,
    aggregatedRating: sql`excluded.aggregated_rating`,
    popularity: sql`excluded.popularity`,
    gameModes: sql`excluded.game_modes`,
    themes: sql`excluded.themes`,
    platforms: sql`excluded.platforms`,
    screenshots: sql`excluded.screenshots`,
    videos: sql`excluded.videos`,
    firstReleaseDate: sql`excluded.first_release_date`,
    playerCount: sql`excluded.player_count`,
    twitchGameId: sql`COALESCE(excluded.twitch_game_id, ${schema.games.twitchGameId})`,
    steamAppId: sql`COALESCE(excluded.steam_app_id, ${schema.games.steamAppId})`,
    crossplay: sql`excluded.crossplay`,
    cachedAt: sql`now()`,
  };
}

/**
 * Upsert a single game row into the database.
 * If a game with the same steamAppId already exists (e.g., from ITAD)
 * but has no igdbId, merge IGDB data into that row instead of inserting
 * a duplicate (ROK-986).
 * @param onGameChanged - ROK-1082: fired after commit with the internal game id
 *                        so the caller can enqueue a taste-vector recompute.
 */
export async function upsertSingleGameRow(
  db: PostgresJsDatabase<typeof schema>,
  row: ReturnType<typeof mapApiGameToDbRow>,
  onGameChanged?: (gameId: number) => void,
): Promise<void> {
  if (row.steamAppId && (await mergeBysteamAppId(db, row, onGameChanged)))
    return;
  await db
    .insert(schema.games)
    .values(row)
    .onConflictDoUpdate({
      target: schema.games.igdbId,
      set: buildUpsertSet(row),
    });
  if (onGameChanged) await notifyBySingleIgdbId(db, row.igdbId, onGameChanged);
}

/** Look up the internal id by igdbId and fire the callback. */
async function notifyBySingleIgdbId(
  db: PostgresJsDatabase<typeof schema>,
  igdbId: number,
  onGameChanged: (gameId: number) => void,
): Promise<void> {
  const rows = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.igdbId, igdbId))
    .limit(1);
  if (rows[0]) onGameChanged(rows[0].id);
}

/** Merge IGDB data into an existing ITAD-sourced game by steamAppId. */
async function mergeBysteamAppId(
  db: PostgresJsDatabase<typeof schema>,
  row: ReturnType<typeof mapApiGameToDbRow>,
  onGameChanged?: (gameId: number) => void,
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
  onGameChanged?.(existing.id);
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

/** Row type produced by mapApiGameToDbRow. */
type GameRow = ReturnType<typeof mapApiGameToDbRow>;

/**
 * Batch pre-check: find existing ITAD-sourced game rows matching any of the
 * provided steamAppIds (no igdbId set). Returns a map of steamAppId -> row id
 * so the caller can merge instead of insert.
 * Replaces per-row SELECTs with ONE IN-clause SELECT (ROK-1024).
 */
async function batchMergeBysteamAppId(
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

/** Apply IGDB data onto an existing ITAD-sourced row identified by internal id. */
async function applyIgdbMergeToRow(
  db: PostgresJsDatabase<typeof schema>,
  existingId: number,
  row: GameRow,
): Promise<void> {
  await db
    .update(schema.games)
    .set({
      ...buildUpsertSet(row),
      igdbId: row.igdbId,
      igdbEnrichmentStatus: 'enriched',
      igdbEnrichmentRetryCount: 0,
    })
    .where(eq(schema.games.id, existingId));
  logger.log(
    `Merged IGDB ${row.igdbId} into existing game ${existingId} by steamAppId`,
  );
}

/**
 * Split rows into two sets: rows that should update an existing ITAD row
 * (merge) vs rows that should go into a fresh batch INSERT.
 */
function splitMergeVsInsert(
  rows: GameRow[],
  mergeMap: Map<number, number>,
): { merges: Array<{ id: number; row: GameRow }>; inserts: GameRow[] } {
  const merges: Array<{ id: number; row: GameRow }> = [];
  const inserts: GameRow[] = [];
  for (const row of rows) {
    const existingId = row.steamAppId
      ? mergeMap.get(row.steamAppId)
      : undefined;
    if (existingId != null) merges.push({ id: existingId, row });
    else inserts.push(row);
  }
  return { merges, inserts };
}

/**
 * Upsert games from IGDB API responses into the local database.
 * Skips games whose igdbId is banned (tombstoned).
 *
 * Performance (ROK-1024): uses ONE batched SELECT for the steamAppId merge
 * pre-check and ONE batched INSERT ... ON CONFLICT DO UPDATE for the
 * remaining rows, instead of per-row queries.
 *
 * @param db - Database connection
 * @param apiGames - Raw IGDB API game objects
 * @param onGameChanged - ROK-1082: fired per touched row after commit so the
 *                        caller can enqueue a taste-vector recompute.
 * @returns Inserted/existing game rows as detail DTOs
 */
export async function upsertGamesFromApi(
  db: PostgresJsDatabase<typeof schema>,
  apiGames: IgdbApiGame[],
  onGameChanged?: (gameId: number) => void,
): Promise<GameDetailDto[]> {
  if (apiGames.length === 0) return [];

  const filteredGames = await filterBannedGames(db, apiGames);
  if (filteredGames.length === 0) return [];

  const rows = filteredGames.map((g) => mapApiGameToDbRow(g));
  const steamAppIds = rows
    .map((r) => r.steamAppId)
    .filter((id): id is number => id != null);
  const mergeMap = await batchMergeBysteamAppId(db, steamAppIds);
  const { merges, inserts } = splitMergeVsInsert(rows, mergeMap);

  for (const { id, row } of merges) {
    await applyIgdbMergeToRow(db, id, row);
  }

  if (inserts.length > 0) {
    await db.insert(schema.games).values(inserts).onConflictDoUpdate({
      target: schema.games.igdbId,
      set: buildBatchUpsertSet(),
    });
  }

  const igdbIds = rows.map((r) => r.igdbId);
  const results = await db
    .select()
    .from(schema.games)
    .where(inArray(schema.games.igdbId, igdbIds));
  if (onGameChanged) {
    for (const r of results) onGameChanged(r.id);
  }
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
