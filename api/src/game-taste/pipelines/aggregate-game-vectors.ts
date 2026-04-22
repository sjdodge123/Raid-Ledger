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
  const activeGames = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(and(eq(schema.games.banned, false), eq(schema.games.hidden, false)));

  for (const { id: gameId } of activeGames) {
    await processGame(db, gameId, batch);
  }
}

/**
 * Single-game recompute path (ROK-1082 event-driven enqueue). Reuses the
 * batch loaders so it stays correct against live corpus stats. The extra
 * full-corpus scans are still sub-second at ~1,656 games; if the queue
 * starts processing hundreds of jobs per minute, revisit batching here.
 */
export async function recomputeGameVector(
  db: Db,
  gameId: number,
): Promise<void> {
  const batch = await loadBatch(db);
  await processGame(db, gameId, batch);
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
    batch.axisIdf as Parameters<typeof computeGameVector>[3],
  );
  await upsertVector(db, gameId, {
    vector,
    dimensions,
    confidence,
    signalHash,
  });
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
