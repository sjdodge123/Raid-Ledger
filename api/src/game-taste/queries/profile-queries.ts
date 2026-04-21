import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  GameTasteProfileResponseDto,
  GameTasteVectorResponseDto,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { loadGameMetadata } from '../../taste-profile/pipelines/aggregate-vectors-loaders';
import {
  computeCorpusStats,
  loadGameSignals,
} from '../pipelines/aggregate-game-vectors-loaders';
import {
  computeAxisIdf,
  computeGameVector,
} from '../game-vector.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Lightweight lookup for the public `GET /games/:id/taste-profile` endpoint.
 * Returns the persisted vector + dimensions + confidence; no derivation.
 */
export async function getGameTasteProfile(
  db: Db,
  gameId: number,
): Promise<GameTasteProfileResponseDto | null> {
  const rows = await db
    .select()
    .from(schema.gameTasteVectors)
    .where(eq(schema.gameTasteVectors.gameId, gameId))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    gameId,
    vector: row.vector,
    dimensions: row.dimensions,
    confidence: Number(row.confidence),
    computedAt: row.computedAt.toISOString(),
  };
}

/**
 * Admin-only lookup for `GET /games/:id/taste-vector`. Returns the persisted
 * vector alongside a re-computed per-axis derivation trail so admins can
 * audit scoring. Derivation is NOT stored; it is reconstructed on-demand
 * from the same inputs the pipeline uses (metadata + signals + corpus IDF).
 */
export async function getVectorWithDerivation(
  db: Db,
  gameId: number,
): Promise<GameTasteVectorResponseDto | null> {
  const rows = await db
    .select()
    .from(schema.gameTasteVectors)
    .where(eq(schema.gameTasteVectors.gameId, gameId))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];

  const [gameMap, signalsByGame] = await Promise.all([
    loadGameMetadata(db),
    loadGameSignals(db),
  ]);
  const metadata = gameMap.get(gameId);
  if (!metadata) return null;
  const corpusStats = computeCorpusStats(signalsByGame);
  const axisIdf = computeAxisIdf(gameMap);
  const signals = signalsByGame.get(gameId) ?? null;
  const { derivation } = computeGameVector(
    metadata,
    signals,
    corpusStats,
    axisIdf,
  );

  return {
    gameId,
    vector: row.vector,
    dimensions: row.dimensions,
    confidence: Number(row.confidence),
    computedAt: row.computedAt.toISOString(),
    derivation,
  };
}
