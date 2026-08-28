import { Logger } from '@nestjs/common';
import { and, eq, inArray, isNull, not } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { GameDetailDto } from '@raid-ledger/contract';
import { IGDB_CONFIG, type IgdbApiGame } from './igdb.constants';
import { mapApiGameToDbRow, mapDbRowToDetail } from './igdb.mappers';
import {
  findGameByNormalizedName,
  findGameIdsByNormalizedName,
} from './igdb-name-dedup.helpers';
import { withGameNameLock } from './games-name-lock.helpers';
import {
  buildUpsertSet,
  buildBatchUpsertSet,
} from './igdb-upsert-sets.helpers';
import { normalizeForDedup } from './igdb-search-dedup.helpers';

const logger = new Logger('IgdbUpsertHelpers');

/**
 * Upsert a single game row. Merges into existing rows by steamAppId (ROK-986)
 * or normalized canonical name (ROK-1113) before inserting. `onGameChanged`
 * (ROK-1082) fires after commit so callers can enqueue a taste-vector recompute.
 *
 * ROK-1438: the whole find-then-insert runs under an advisory lock keyed on the
 * normalized name, so a concurrent upsert of the same title blocks instead of
 * read-missing and inserting a twin row.
 */
export async function upsertSingleGameRow(
  db: PostgresJsDatabase<typeof schema>,
  row: ReturnType<typeof mapApiGameToDbRow>,
  onGameChanged?: (gameId: number) => void,
): Promise<void> {
  const touchedId = await withGameNameLock(db, row.name, (tx) =>
    upsertSingleGameRowLocked(tx, row),
  );
  // After commit: a rolled-back transaction must not announce writes that
  // never landed.
  if (touchedId != null) onGameChanged?.(touchedId);
}

/**
 * Find-then-insert body for a single row. MUST run inside the name lock.
 * Returns the id of the row it merged into or inserted.
 */
async function upsertSingleGameRowLocked(
  tx: PostgresJsDatabase<typeof schema>,
  row: ReturnType<typeof mapApiGameToDbRow>,
): Promise<number | null> {
  if (row.steamAppId) {
    const bySteam = await mergeBysteamAppId(tx, row);
    if (bySteam != null) return bySteam;
  }
  const byName = await mergeByNormalizedName(tx, row);
  if (byName != null) return byName;

  // RETURNING covers both branches of the upsert, replacing the follow-up
  // SELECT the pre-ROK-1438 code needed to resolve the id.
  const inserted = await tx
    .insert(schema.games)
    .values(row)
    .onConflictDoUpdate({
      target: schema.games.igdbId,
      set: buildUpsertSet(row),
    })
    .returning({ id: schema.games.id });
  return inserted[0]?.id ?? null;
}

/**
 * Merge IGDB data into an existing row whose canonical name matches (ROK-1113).
 * Returns the merged row id, or null when no row matched.
 *
 * Skip if the existing row has a *different* non-null igdbId — IGDB ids are
 * canonical, so a mismatch signals a sequel/variant we should NOT collapse.
 */
async function mergeByNormalizedName(
  tx: PostgresJsDatabase<typeof schema>,
  row: ReturnType<typeof mapApiGameToDbRow>,
): Promise<number | null> {
  const match = await findGameByNormalizedName(tx, row.name);
  if (!match) return null;
  if (match.igdbId != null && match.igdbId !== row.igdbId) return null;
  await applyIgdbMergeToRow(tx, match.id, row);
  return match.id;
}

/**
 * Merge IGDB data into an existing ITAD-sourced game by steamAppId.
 * Returns the merged row id, or null when no row matched.
 */
async function mergeBysteamAppId(
  tx: PostgresJsDatabase<typeof schema>,
  row: ReturnType<typeof mapApiGameToDbRow>,
): Promise<number | null> {
  const [existing] = await tx
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(
      and(
        eq(schema.games.steamAppId, row.steamAppId!),
        isNull(schema.games.igdbId),
      ),
    )
    .limit(1);
  if (!existing) return null;
  await applyIgdbMergeToRow(tx, existing.id, row);
  return existing.id;
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
 * Move rows that match an existing row's normalized name from `inserts` to
 * `merges` (ROK-1113). Skips name-matches when the existing row's igdbId
 * disagrees with the incoming row — IGDB ids are canonical.
 */
function applyNameMergeMap(
  inserts: GameRow[],
  nameMap: Map<string, { id: number; igdbId: number | null }>,
  normalize: (name: string) => string,
): { nameMerges: Array<{ id: number; row: GameRow }>; inserts: GameRow[] } {
  const nameMerges: Array<{ id: number; row: GameRow }> = [];
  const remaining: GameRow[] = [];
  for (const row of inserts) {
    const match = nameMap.get(normalize(row.name));
    if (match && (match.igdbId == null || match.igdbId === row.igdbId)) {
      nameMerges.push({ id: match.id, row });
    } else {
      remaining.push(row);
    }
  }
  return { nameMerges, inserts: remaining };
}

/**
 * Upsert games from IGDB API responses. Merges into existing rows by steamAppId
 * (ROK-1024) and normalized canonical name (ROK-1113), then runs ONE batched
 * INSERT ... ON CONFLICT DO UPDATE for the remainder. `onGameChanged` (ROK-1082)
 * fires per touched row so callers can enqueue a taste-vector recompute.
 *
 * ROK-1438: merges + insert run under advisory locks on every incoming
 * normalized name, taken in sorted order so two overlapping batches cannot
 * deadlock. The largest batch in the codebase is `discoverPopularGames` at 100
 * names.
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
  const results = await withGameNameLock(
    db,
    rows.map((r) => r.name),
    (tx) => applyBatchUpsert(tx, rows),
  );
  // After commit, per the ROK-1082 contract.
  if (onGameChanged) for (const r of results) onGameChanged(r.id);
  return results.map((g) => mapDbRowToDetail(g));
}

/** Batch merge + insert body. MUST run inside the name locks. */
async function applyBatchUpsert(
  tx: PostgresJsDatabase<typeof schema>,
  rows: GameRow[],
): Promise<(typeof schema.games.$inferSelect)[]> {
  const insertsAfter = await mergeExistingRows(tx, rows);
  if (insertsAfter.length > 0) {
    await tx.insert(schema.games).values(insertsAfter).onConflictDoUpdate({
      target: schema.games.igdbId,
      set: buildBatchUpsertSet(),
    });
  }
  const igdbIds = rows.map((r) => r.igdbId);
  return tx
    .select()
    .from(schema.games)
    .where(inArray(schema.games.igdbId, igdbIds));
}

/**
 * Apply steamAppId + normalized-name merges and return rows that should proceed
 * to the batch INSERT.
 */
async function mergeExistingRows(
  db: PostgresJsDatabase<typeof schema>,
  rows: GameRow[],
): Promise<GameRow[]> {
  const steamAppIds = rows
    .map((r) => r.steamAppId)
    .filter((id): id is number => id != null);
  const mergeMap = await batchMergeBysteamAppId(db, steamAppIds);
  const { merges, inserts } = splitMergeVsInsert(rows, mergeMap);

  const nameMap = await findGameIdsByNormalizedName(
    db,
    inserts.map((r) => r.name),
  );
  const { nameMerges, inserts: insertsAfterName } = applyNameMergeMap(
    inserts,
    nameMap,
    normalizeForDedup,
  );

  for (const { id, row } of merges) await applyIgdbMergeToRow(db, id, row);
  for (const { id, row } of nameMerges) {
    await applyIgdbMergeToRow(db, id, row);
    logger.log(
      `Merged IGDB ${row.igdbId} into existing game ${id} by normalized name`,
    );
  }
  return insertsAfterName;
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
