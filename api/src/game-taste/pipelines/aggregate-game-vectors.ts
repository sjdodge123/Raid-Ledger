import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  computeAxisIdf,
  computeGameVector,
  type GameMetadata,
  type GameSignals,
  type CorpusStats,
} from '../game-vector.helpers';
import {
  computeGameSignalHash,
  type GameSignalSummary,
} from '../signal-hash.helpers';
import {
  loadGameMetadata,
  loadGameMetadataForIds,
} from '../../taste-profile/pipelines/aggregate-vectors-loaders';
import {
  computeCorpusStats,
  hashMetadataArrays,
  loadExistingVectorHashes,
  loadGameSignals,
  loadGameSignalsForIds,
} from './aggregate-game-vectors-loaders';

type Db = PostgresJsDatabase<typeof schema>;

interface AggregateBatch {
  gameMap: Map<number, GameMetadata>;
  signalsByGame: Map<number, GameSignals>;
  corpusStats: CorpusStats;
  existingHashes: Map<number, string>;
  axisIdf: Record<string, number>;
}

/**
 * Entry point for the daily game-taste-vector cron (ROK-1082).
 *
 * Load-once / write-many: batches all reads, iterates non-banned +
 * non-hidden games, skips games whose signal hash hasn't changed, and
 * upserts fresh vectors via ON CONFLICT DO UPDATE.
 */
export async function runAggregateGameVectors(db: Db): Promise<void> {
  const batch = await loadBatch(db);
  primeBatchCache(batch);
  const activeGames = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(and(eq(schema.games.banned, false), eq(schema.games.hidden, false)));

  for (const { id: gameId } of activeGames) {
    await processGame(db, gameId, batch);
  }
}

/**
 * Single-game recompute path (ROK-1082 event-driven enqueue).
 *
 * Corpus-wide state comes from the shared TTL batch cache (ROK-1102 #2)
 * instead of a full reload per job — a burst of 50 enqueued games used to
 * mean 50 full-corpus scans at ~920ms each. The TARGET game's own inputs
 * are always re-read fresh first: this job runs *because* that game just
 * changed, so hashing it from a ≤60s-old batch would match the stored
 * hash and silently drop the write.
 */
export async function recomputeGameVector(
  db: Db,
  gameId: number,
): Promise<void> {
  const batch = await getCachedBatch(db);
  await refreshGameInputs(db, gameId, batch);
  await processGame(db, gameId, batch);
}

/**
 * Overwrite one game's metadata + signals in the (possibly cached) batch
 * with a fresh narrow read. Deletes the entry when the game has gone
 * away (banned/hidden/removed) so `processGame` no-ops instead of
 * recomputing from a stale row.
 */
async function refreshGameInputs(
  db: Db,
  gameId: number,
  batch: AggregateBatch,
): Promise<void> {
  const [metadata, signals] = await Promise.all([
    loadGameMetadataForIds(db, [gameId]),
    loadGameSignalsForIds(db, [gameId]),
  ]);
  const freshMetadata = metadata.get(gameId);
  if (freshMetadata) batch.gameMap.set(gameId, freshMetadata);
  else batch.gameMap.delete(gameId);

  const freshSignals = signals.get(gameId);
  if (freshSignals) batch.signalsByGame.set(gameId, freshSignals);
  else batch.signalsByGame.delete(gameId);
}

/**
 * Shared corpus batch for the per-job path, cached for
 * `BATCH_CACHE_TTL_MS` (ROK-1102 #2 operator ruling, 2026-09-12).
 *
 * Freshness contract: the TARGET game's metadata + signals are always
 * re-read per job by `refreshGameInputs`, and `processGame` writes each
 * upserted hash back into `existingHashes`. What MAY be up to 60s stale
 * is the corpus-wide state — `corpusStats`, `axisIdf`, and other games'
 * metadata/signals — which is the accepted trade-off; the daily cron
 * always loads fresh. The promise (not the resolved value) is cached, so
 * a burst of concurrent jobs on a cold cache shares ONE load; a rejected
 * load evicts itself so the next job retries. No manual invalidation.
 */
const BATCH_CACHE_TTL_MS = 60_000;

let batchCache: { batch: Promise<AggregateBatch>; loadedAt: number } | null =
  null;

function getCachedBatch(db: Db): Promise<AggregateBatch> {
  const now = Date.now();
  if (batchCache && now - batchCache.loadedAt < BATCH_CACHE_TTL_MS) {
    return batchCache.batch;
  }
  const entry = { batch: loadBatch(db), loadedAt: now };
  batchCache = entry;
  entry.batch.catch(() => {
    if (batchCache === entry) batchCache = null;
  });
  return entry.batch;
}

/** Keep the next per-job recompute warm off the cron's fresh load. */
function primeBatchCache(batch: AggregateBatch): void {
  batchCache = { batch: Promise.resolve(batch), loadedAt: Date.now() };
}

/** Test seam: drop the cached batch so each spec starts cold. */
export function __resetBatchCacheForTests(): void {
  batchCache = null;
}

async function loadBatch(db: Db): Promise<AggregateBatch> {
  const [gameMap, signalsByGame, existingHashes] = await Promise.all([
    loadGameMetadata(db),
    loadGameSignals(db),
    loadExistingVectorHashes(db),
  ]);
  const corpusStats = computeCorpusStats(signalsByGame);
  const axisIdf = computeAxisIdf(gameMap);
  return { gameMap, signalsByGame, corpusStats, existingHashes, axisIdf };
}

async function processGame(
  db: Db,
  gameId: number,
  batch: AggregateBatch,
): Promise<void> {
  const metadata = batch.gameMap.get(gameId);
  if (!metadata) return;
  const signals = batch.signalsByGame.get(gameId) ?? null;
  const signalHash = buildSignalHash(metadata, signals);
  if (batch.existingHashes.get(gameId) === signalHash) return;

  const { dimensions, vector, confidence } = computeGameVector(
    metadata,
    signals,
    batch.corpusStats,
    batch.axisIdf,
  );
  await upsertVector(db, gameId, {
    vector,
    dimensions,
    confidence,
    signalHash,
  });
  // Keep the (possibly cached) batch consistent with what we just wrote so a
  // repeat job for this game inside the TTL short-circuits above.
  batch.existingHashes.set(gameId, signalHash);
}

function buildSignalHash(
  metadata: GameMetadata,
  signals: GameSignals | null,
): string {
  const summary: GameSignalSummary = {
    gameId: metadata.gameId,
    playtimeTotal: signals?.playtimeSeconds ?? 0,
    interestCount: signals?.interestCount ?? 0,
    ...hashMetadataArrays(metadata),
  };
  return computeGameSignalHash(summary);
}

async function upsertVector(
  db: Db,
  gameId: number,
  payload: {
    vector: number[];
    dimensions: ReturnType<typeof computeGameVector>['dimensions'];
    confidence: number;
    signalHash: string;
  },
): Promise<void> {
  await db
    .insert(schema.gameTasteVectors)
    .values({
      gameId,
      vector: payload.vector,
      dimensions: payload.dimensions,
      confidence: payload.confidence,
      signalHash: payload.signalHash,
    })
    .onConflictDoUpdate({
      target: schema.gameTasteVectors.gameId,
      set: {
        vector: payload.vector,
        dimensions: payload.dimensions,
        confidence: payload.confidence,
        signalHash: payload.signalHash,
        computedAt: new Date(),
      },
    });
}
