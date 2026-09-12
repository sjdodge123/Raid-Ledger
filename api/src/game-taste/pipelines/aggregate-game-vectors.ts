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
import { loadGameMetadata } from '../../taste-profile/pipelines/aggregate-vectors-loaders';
import {
  computeCorpusStats,
  hashMetadataArrays,
  loadExistingVectorHashes,
  loadGameSignals,
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
 * Served from the shared TTL batch cache (ROK-1102 #2) instead of
 * reloading the whole corpus per job — a burst of 50 enqueued games used
 * to mean 50 full-corpus scans at ~920ms each.
 */
export async function recomputeGameVector(
  db: Db,
  gameId: number,
): Promise<void> {
  const batch = await getCachedBatch(db);
  await processGame(db, gameId, batch);
}

/**
 * Shared corpus batch for the per-job path, cached for
 * `BATCH_CACHE_TTL_MS` (ROK-1102 #2 operator ruling, 2026-09-12).
 *
 * The promise — not the resolved value — is cached, so a burst of
 * concurrent jobs on a cold cache shares ONE load; a rejected load
 * evicts itself so the next job retries. There is deliberately no manual
 * invalidation: metadata/signals of OTHER games may be up to 60s stale,
 * which is the accepted trade-off (the daily cron is always fresh, and
 * `processGame` writes each game's own hash back into the cached batch).
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
