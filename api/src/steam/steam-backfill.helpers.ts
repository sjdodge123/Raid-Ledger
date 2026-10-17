import { Logger } from '@nestjs/common';
import { IGDB_CONFIG, type IgdbApiGame } from '../igdb/igdb.constants';
import { delay } from '../igdb/igdb-api.helpers';

const logger = new Logger('SteamBackfill');

/** Number of Steam app IDs to query per IGDB batch. */
export const BACKFILL_BATCH_SIZE = 50;

/** Maximum total Steam app IDs to look up per sync. */
export const MAX_BACKFILL_LOOKUPS = 500;

/** Delay between IGDB batches (ms). */
const BATCH_DELAY_MS = 250;

/**
 * Build the IGDB query for a batch of Steam app IDs.
 * @param appIds - Steam app IDs to look up
 * @returns APICALYPSE query string
 */
export function buildBackfillQuery(appIds: number[]): string {
  const uids = appIds.map((id) => `"${id}"`).join(',');
  return (
    `fields ${IGDB_CONFIG.EXPANDED_FIELDS}; ` +
    `where external_games.uid = (${uids}) ` +
    `& external_games.category = ${IGDB_CONFIG.STEAM_CATEGORY_ID}; ` +
    `limit ${BACKFILL_BATCH_SIZE};`
  );
}

/**
 * Process a single batch of Steam app IDs against IGDB.
 * @returns Number of games imported, or 0 on failure
 */
async function processBatch(
  appIds: number[],
  queryIgdb: (body: string) => Promise<IgdbApiGame[]>,
  upsertGames: (games: IgdbApiGame[]) => Promise<unknown>,
): Promise<number> {
  try {
    const games = await queryIgdb(buildBackfillQuery(appIds));
    if (games.length > 0) await upsertGames(games);
    return games.length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    logger.warn(`Backfill batch failed: ${msg}`);
    return 0;
  }
}

/**
 * Look up unmatched Steam app IDs on IGDB and import them.
 * Batches requests to avoid IGDB rate limits.
 * @param unmatchedAppIds - Steam app IDs not found in local DB
 * @param queryIgdb - Function to query IGDB API
 * @param upsertGames - Function to upsert API games into the DB
 * @returns Count of newly imported games
 */
export async function backfillUnmatchedSteamGames(
  unmatchedAppIds: number[],
  queryIgdb: (body: string) => Promise<IgdbApiGame[]>,
  upsertGames: (games: IgdbApiGame[]) => Promise<unknown>,
): Promise<number> {
  if (unmatchedAppIds.length === 0) return 0;

  const capped = unmatchedAppIds.slice(0, MAX_BACKFILL_LOOKUPS);
  let totalImported = 0;

  for (let i = 0; i < capped.length; i += BACKFILL_BATCH_SIZE) {
    const batch = capped.slice(i, i + BACKFILL_BATCH_SIZE);
    totalImported += await processBatch(batch, queryIgdb, upsertGames);
    if (i + BACKFILL_BATCH_SIZE < capped.length) await delay(BATCH_DELAY_MS);
  }

  if (totalImported > 0) {
    logger.log(`Backfilled ${totalImported} games from IGDB`);
  }
  return totalImported;
}
