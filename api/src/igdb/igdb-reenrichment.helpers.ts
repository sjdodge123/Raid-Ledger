/**
 * IGDB re-enrichment helpers (ROK-986).
 *
 * Retries IGDB metadata lookup for games that have a Steam app ID
 * but failed initial enrichment. Runs during the 6-hour cron sync
 * and via on-demand delayed BullMQ jobs.
 */
import { Logger } from '@nestjs/common';
import { eq, and, inArray, isNotNull, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { games } from '../drizzle/schema';
import type { IgdbApiGame } from './igdb.constants';
import { IGDB_CONFIG } from './igdb.constants';
import {
  buildExternalGamesQuery,
  parseIgdbEnrichment,
} from './igdb-itad-enrich.helpers';

const logger = new Logger('IgdbReEnrichment');

/** Maximum retry attempts before marking a game as 'not_found'. */
const MAX_RETRIES = 3;

/** Number of games to process per batch. */
const BATCH_SIZE = 3;

/** Delay between batches in milliseconds. */
const BATCH_DELAY_MS = 500;

export interface ReEnrichResult {
  attempted: number;
  enriched: number;
  failed: number;
  exhausted: number;
}

type Db = PostgresJsDatabase<typeof schema>;
type QueryIgdb = (body: string) => Promise<IgdbApiGame[]>;

/** Candidate row shape from the SELECT query. */
interface Candidate {
  id: number;
  name: string;
  steamAppId: number;
  igdbEnrichmentRetryCount: number;
}

/**
 * Re-enrich games that have a Steam App ID but are missing IGDB metadata.
 * Queries candidates with status IN ('pending', 'failed'), non-null steamAppId,
 * and retry count < 3. Processes in batches of 3 with 500ms delay.
 *
 * @param db - Database connection
 * @param queryIgdb - Function to execute IGDB queries
 * @returns Enrichment result counts
 */
export async function reEnrichGamesWithIgdb(
  db: Db,
  queryIgdb: QueryIgdb,
): Promise<ReEnrichResult> {
  const candidates = await selectCandidates(db);
  if (candidates.length === 0) {
    return { attempted: 0, enriched: 0, failed: 0, exhausted: 0 };
  }
  return processBatches(db, queryIgdb, candidates);
}

/** Select games eligible for re-enrichment. */
async function selectCandidates(db: Db): Promise<Candidate[]> {
  const rows = await db
    .select({
      id: games.id,
      name: games.name,
      steamAppId: games.steamAppId,
      igdbEnrichmentRetryCount: games.igdbEnrichmentRetryCount,
    })
    .from(games)
    .where(
      and(
        inArray(games.igdbEnrichmentStatus, ['pending', 'failed']),
        isNotNull(games.steamAppId),
        lt(games.igdbEnrichmentRetryCount, MAX_RETRIES),
      ),
    );
  // isNotNull guarantees steamAppId is non-null at runtime
  return rows as Candidate[];
}

/** Process candidates in batches with delay between each. */
async function processBatches(
  db: Db,
  queryIgdb: QueryIgdb,
  candidates: Candidate[],
): Promise<ReEnrichResult> {
  const result: ReEnrichResult = {
    attempted: candidates.length,
    enriched: 0,
    failed: 0,
    exhausted: 0,
  };

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    if (i > 0) await delay(BATCH_DELAY_MS);
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map((c) => enrichSingleCandidate(db, queryIgdb, c)),
    );
    tallySingleResults(settled, result);
  }

  return result;
}

/** Tally individual candidate results into the aggregate. */
function tallySingleResults(
  settled: PromiseSettledResult<SingleResult>[],
  result: ReEnrichResult,
): void {
  for (const s of settled) {
    if (s.status === 'rejected') {
      result.failed++;
      continue;
    }
    if (s.value === 'enriched') result.enriched++;
    else if (s.value === 'exhausted') result.exhausted++;
  }
}

type SingleResult = 'enriched' | 'not_found' | 'exhausted';

/** Attempt IGDB enrichment: Steam ID first, then name-based fallback. */
async function enrichSingleCandidate(
  db: Db,
  queryIgdb: QueryIgdb,
  candidate: Candidate,
): Promise<SingleResult> {
  try {
    const byId = await queryIgdb(buildExternalGamesQuery(candidate.steamAppId));
    if (byId.length > 0) return handleSuccess(db, candidate, byId[0]);
    const byName = await searchByName(queryIgdb, candidate.name);
    if (byName) return handleSuccess(db, candidate, byName);
    return handleNotFound(db, candidate);
  } catch (err) {
    await handleError(db, candidate, err);
    throw err;
  }
}

/** Fallback: search IGDB by game name when Steam ID lookup fails. */
async function searchByName(
  queryIgdb: QueryIgdb,
  name: string,
): Promise<IgdbApiGame | null> {
  const sanitized = name.replace(/"/g, '\\"');
  const query = `search "${sanitized}"; fields ${IGDB_CONFIG.EXPANDED_FIELDS}; limit 5;`;
  const results = await queryIgdb(query);
  if (results.length === 0) return null;
  const match = findBestNameMatch(results, name);
  if (match) logger.log(`Name fallback matched "${name}" → IGDB ${match.id}`);
  return match;
}

/** Pick the best name match, requiring high similarity. */
function findBestNameMatch(
  results: IgdbApiGame[],
  targetName: string,
): IgdbApiGame | null {
  const target = normalizeName(targetName);
  for (const game of results) {
    if (!game.name) continue;
    if (normalizeName(game.name) === target) return game;
  }
  return null;
}

/** Normalize a game name for comparison (lowercase, strip punctuation). */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Handle a successful IGDB match — update game with enrichment data. */
async function handleSuccess(
  db: Db,
  candidate: Candidate,
  igdbGame: IgdbApiGame,
): Promise<'enriched'> {
  const data = parseIgdbEnrichment({ ...igdbGame, id: igdbGame.id });
  const videos = data.videos?.map((v) => ({
    name: v.name ?? '',
    videoId: v.videoId,
  }));
  await db
    .update(games)
    .set({
      ...data,
      videos: videos ?? null,
      igdbEnrichmentStatus: 'enriched',
      igdbEnrichmentRetryCount: 0,
    })
    .where(eq(games.id, candidate.id));
  logger.log(`Re-enriched game ${candidate.id} with IGDB ${igdbGame.id}`);
  return 'enriched';
}

/** Handle IGDB returning 0 results — increment retry, maybe exhaust. */
async function handleNotFound(
  db: Db,
  candidate: Candidate,
): Promise<'not_found' | 'exhausted'> {
  const newCount = candidate.igdbEnrichmentRetryCount + 1;
  const exhausted = newCount >= MAX_RETRIES;
  const status = exhausted ? 'not_found' : 'pending';

  await db
    .update(games)
    .set({ igdbEnrichmentStatus: status, igdbEnrichmentRetryCount: newCount })
    .where(eq(games.id, candidate.id));

  if (exhausted) {
    logger.warn(`Game ${candidate.id} exhausted IGDB re-enrichment retries`);
  }
  return exhausted ? 'exhausted' : 'not_found';
}

/** Handle IGDB API error — increment retry, set failed. */
async function handleError(
  db: Db,
  candidate: Candidate,
  err: unknown,
): Promise<void> {
  const newCount = candidate.igdbEnrichmentRetryCount + 1;
  await db
    .update(games)
    .set({ igdbEnrichmentStatus: 'failed', igdbEnrichmentRetryCount: newCount })
    .where(eq(games.id, candidate.id));
  logger.warn(
    `IGDB re-enrichment failed for game ${candidate.id}: ${String(err)}`,
  );
}

/** Promise-based delay. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
