import { inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  SimilarGameDto,
  SimilarGamesRequestDto,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Default confidence filter for similarity results.
 *
 * A zero-signal game (no tags, no interests, no playtime, no metadata) scores
 * `confidence = 0`. Any signal at all raises the score above zero. Using
 * `0.0001` as the default threshold excludes true stub rows while including
 * low-signal-but-meaningful games. Operators can widen/narrow the filter per
 * query via the second parameter to `findSimilarGames`.
 */
const DEFAULT_MIN_CONFIDENCE = 0.0001;

type SimilarityRow = {
  game_id: number;
  name: string;
  cover_url: string | null;
  distance: string;
} & Record<string, unknown>;

/**
 * Find the closest games (by pgvector cosine distance) to a target 7-axis
 * vector. The target is resolved from exactly one of:
 *   - `userId`   → the user's player_taste_vector
 *   - `userIds`  → element-wise mean of the given players' vectors
 *   - `gameId`   → the game's game_taste_vector (self excluded from results)
 *
 * Filters banned + hidden games, and by default hides zero-signal games
 * (confidence < DEFAULT_MIN_CONFIDENCE) so similarity results don't include
 * stub rows. Callers can widen the filter by passing `minConfidence`.
 */
export async function findSimilarGames(
  db: Db,
  input: SimilarGamesRequestDto,
  minConfidence: number = DEFAULT_MIN_CONFIDENCE,
): Promise<SimilarGameDto[]> {
  const limit = input.limit ?? 10;
  const target = await resolveTarget(db, input);
  if (!target) return [];
  const excludeId = input.gameId !== undefined ? input.gameId : null;
  const rows = await executeSimilarityQuery(
    db,
    target,
    limit,
    minConfidence,
    excludeId,
  );
  return rows.map(toSimilarGameDto);
}

async function resolveTarget(
  db: Db,
  input: SimilarGamesRequestDto,
): Promise<number[] | null> {
  if (input.userId !== undefined) return loadPlayerVector(db, input.userId);
  if (input.userIds !== undefined)
    return loadPlayerVectorCentroid(db, input.userIds);
  if (input.gameId !== undefined) return loadGameVector(db, input.gameId);
  return null;
}

async function loadPlayerVector(
  db: Db,
  userId: number,
): Promise<number[] | null> {
  const rows = await db
    .select({ vector: schema.playerTasteVectors.vector })
    .from(schema.playerTasteVectors)
    .where(sql`${schema.playerTasteVectors.userId} = ${userId}`)
    .limit(1);
  if (rows.length === 0) return null;
  return rows[0].vector;
}

async function loadPlayerVectorCentroid(
  db: Db,
  userIds: number[],
): Promise<number[] | null> {
  if (userIds.length === 0) return null;
  const rows = await db
    .select({ vector: schema.playerTasteVectors.vector })
    .from(schema.playerTasteVectors)
    .where(inArray(schema.playerTasteVectors.userId, userIds));
  if (rows.length === 0) return null;
  return elementwiseMean(rows.map((r) => r.vector));
}

async function loadGameVector(
  db: Db,
  gameId: number,
): Promise<number[] | null> {
  const rows = await db
    .select({ vector: schema.gameTasteVectors.vector })
    .from(schema.gameTasteVectors)
    .where(sql`${schema.gameTasteVectors.gameId} = ${gameId}`)
    .limit(1);
  if (rows.length === 0) return null;
  return rows[0].vector;
}

function elementwiseMean(vectors: number[][]): number[] {
  const width = vectors[0].length;
  const out = new Array<number>(width).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < width; i += 1) out[i] += v[i];
  }
  const n = vectors.length;
  for (let i = 0; i < width; i += 1) out[i] /= n;
  return out;
}

async function executeSimilarityQuery(
  db: Db,
  target: number[],
  limit: number,
  minConfidence: number,
  excludeGameId: number | null,
): Promise<SimilarityRow[]> {
  const targetLiteral = `[${target.join(',')}]`;
  const excludeClause =
    excludeGameId !== null ? sql`AND g.id <> ${excludeGameId}` : sql``;
  // No HNSW index on `vector` yet — the spec defers it until the corpus
  // exceeds ~500 games. A seqscan + in-memory sort over ~2K rows is still
  // sub-ms; revisit if the corpus grows much past 5K or if the confidence
  // + banned/hidden filters start dominating plan cost.
  return db.execute<SimilarityRow>(sql`
    SELECT g.id AS game_id, g.name, g.cover_url,
           (gtv.vector <=> ${targetLiteral}::vector) AS distance
    FROM game_taste_vectors gtv
    JOIN games g ON g.id = gtv.game_id
    WHERE g.banned = false
      AND g.hidden = false
      AND gtv.confidence >= ${minConfidence}
      ${excludeClause}
    ORDER BY gtv.vector <=> ${targetLiteral}::vector ASC
    LIMIT ${limit}
  `);
}

function toSimilarGameDto(row: SimilarityRow): SimilarGameDto {
  return {
    gameId: row.game_id,
    name: row.name,
    coverUrl: row.cover_url,
    similarity: Math.max(0, 1 - Number(row.distance)),
  };
}
