import { Logger } from '@nestjs/common';
import { and, eq, inArray, isNull, not } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { GameDetailDto } from '@raid-ledger/contract';
import { IGDB_CONFIG, type IgdbApiGame } from './igdb.constants';
import { mapApiGameToDbRow, mapDbRowToDetail } from './igdb.mappers';
import { findGameIdsByNormalizedName } from './igdb-name-dedup.helpers';
import {
  batchMergeBysteamAppId,
  findByNormalizedName,
  findBySteamAppId,
} from './igdb-merge-targets.helpers';
import { withGameNameLock } from './games-name-lock.helpers';
import { withTasteInputDiff } from './taste-input-change.helpers';
import {
  buildUpsertSet,
  buildBatchUpsertSet,
} from './igdb-upsert-sets.helpers';
import { normalizeForDedup } from './igdb-search-dedup.helpers';
import { fetchCoversInChunks } from './igdb-cover-backfill.helpers';
import {
  classifyMerge,
  guardInsertRows,
  loadKeyOwners,
  recordOwner,
  type KeyOwners,
} from './igdb-upsert-collisions.helpers';

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
  // ROK-2120: classify every write against the current key owners first, so
  // a twin row holding the igdb_id/slug/steam id is reported, not violated.
  const owners = await loadKeyOwners(tx, [row]);
  const target = await findSingleMergeTarget(tx, row);
  if (target != null) {
    const verdict = classifyMerge(target.id, row, owners);
    if (verdict === 'skip') return null;
    if (verdict === 'merge') {
      await applyIgdbMergeToRow(tx, target.id, row, target.reason);
      return target.id;
    }
  }
  const [guarded] = guardInsertRows([row], owners);
  if (guarded === undefined) return null;
  // RETURNING covers both branches of the upsert, replacing the follow-up
  // SELECT the pre-ROK-1438 code needed to resolve the id.
  const inserted = await tx
    .insert(schema.games)
    .values(guarded)
    .onConflictDoUpdate({
      target: schema.games.igdbId,
      set: buildUpsertSet(guarded),
    })
    .returning({ id: schema.games.id });
  return inserted[0]?.id ?? null;
}

/** Why a row was merged into an existing one — named in the merge log. */
type MergeReason = 'steamAppId' | 'normalized name';

/** Existing row the single path should merge into (steam first, then name). */
async function findSingleMergeTarget(
  tx: PostgresJsDatabase<typeof schema>,
  row: GameRow,
): Promise<{ id: number; reason: MergeReason } | null> {
  if (row.steamAppId) {
    const bySteam = await findBySteamAppId(tx, row.steamAppId);
    if (bySteam != null) return { id: bySteam, reason: 'steamAppId' };
  }
  const byName = await findByNormalizedName(tx, row);
  return byName == null ? null : { id: byName, reason: 'normalized name' };
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

/** Apply IGDB data onto an existing row; the log names the real `reason`. */
async function applyIgdbMergeToRow(
  db: PostgresJsDatabase<typeof schema>,
  existingId: number,
  row: GameRow,
  reason: MergeReason,
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
    `Merged IGDB ${row.igdbId} into existing game ${existingId} by ${reason}`,
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
 * fires per row whose taste inputs changed (ROK-2121) so callers can enqueue
 * a taste-vector recompute.
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
  // ROK-2121: diff taste inputs inside the lock; only changed rows fire.
  const { results, changedIds } = await withGameNameLock(
    db,
    rows.map((r) => r.name),
    (tx) =>
      withTasteInputDiff(
        tx,
        rows,
        () => applyBatchUpsert(tx, rows),
        onGameChanged != null,
      ),
  );
  // After commit, per the ROK-1082 contract.
  if (onGameChanged) for (const id of changedIds) onGameChanged(id);
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

  // ROK-2120: owners are read before any merge so a colliding write is never
  // issued; rerouted rows join the insert, which is guarded the same way.
  const owners = await loadKeyOwners(db, rows);
  const rerouted = await applyMergesInIdOrder(db, merges, nameMerges, owners);
  return guardInsertRows([...insertsAfterName, ...rerouted], owners);
}

/**
 * Apply both merge sets as UPDATEs, ordered by row id.
 *
 * The order matters now that the batch runs in one transaction (ROK-1438):
 * row locks are held to commit, so two concurrent batches that touched the
 * same two rows in opposite orders could deadlock. A batch's advisory locks
 * cover the names it is INSERTING, which is not the same set as the names of
 * the rows it MERGES INTO (a steamAppId merge lands on a row with an
 * unrelated name), so they don't prevent this on their own. Ascending id is a
 * total order every caller agrees on, so no cycle can form.
 */
async function applyMergesInIdOrder(
  db: PostgresJsDatabase<typeof schema>,
  merges: Array<{ id: number; row: GameRow }>,
  nameMerges: Array<{ id: number; row: GameRow }>,
  owners: KeyOwners,
): Promise<GameRow[]> {
  const ordered = [
    ...merges.map((m) => ({ ...m, reason: 'steamAppId' as const })),
    ...nameMerges.map((m) => ({ ...m, reason: 'normalized name' as const })),
  ].sort((a, b) => a.id - b.id);
  const rerouted: GameRow[] = [];
  for (const { id, row, reason } of ordered) {
    const verdict = classifyMerge(id, row, owners);
    if (verdict === 'reroute') rerouted.push(row);
    if (verdict !== 'merge') continue;
    await applyIgdbMergeToRow(db, id, row, reason);
    recordOwner(owners, id, row);
  }
  return rerouted;
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

  const ids = missingCovers.flatMap((g) =>
    g.igdbId === null ? [] : [g.igdbId],
  );
  const coverResults = await fetchCoversInChunks(ids, queryIgdb);

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
