import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SimilarGameDto } from '@raid-ledger/contract';
import type { GameTasteService } from '../../game-taste/game-taste.service';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Candidate pool size passed to the LLM — trades prompt tokens vs choice. */
export const CANDIDATE_POOL_SIZE = 30;

/** How many past winners we exclude (spec: last-3-winners). */
const RECENT_WINNER_WINDOW = 3;

async function loadAlreadyNominatedGameIds(
  db: Db,
  lineupId: number,
): Promise<Set<number>> {
  const rows = await db
    .select({ gameId: schema.communityLineupEntries.gameId })
    .from(schema.communityLineupEntries)
    .where(eq(schema.communityLineupEntries.lineupId, lineupId));
  return new Set(rows.map((r) => r.gameId));
}

async function loadRecentWinnerGameIds(db: Db): Promise<Set<number>> {
  const rows = await db
    .select({ gameId: schema.communityLineups.decidedGameId })
    .from(schema.communityLineups)
    .where(
      and(
        eq(schema.communityLineups.status, 'decided'),
        isNotNull(schema.communityLineups.decidedGameId),
      ),
    )
    .orderBy(desc(schema.communityLineups.updatedAt))
    .limit(RECENT_WINNER_WINDOW);
  return new Set(
    rows
      .map((r) => r.gameId)
      .filter((id): id is number => id !== null && id !== undefined),
  );
}

/**
 * Build the candidate pool fed to the LLM.
 *
 *   1. pgvector similarity: top-N games nearest to the voter centroid
 *      (multiplayer-only — Community Lineup is group play).
 *   2. Subtract games already nominated on this lineup.
 *   3. Subtract games that won any of the last 3 decided lineups.
 *
 * Returns [] when the voter set has no combined vector (empty fallback
 * pool) — the caller skips the LLM and caches an empty result.
 */
export async function buildCandidatePool(
  db: Db,
  gameTaste: GameTasteService,
  voterIds: number[],
  lineupId: number,
): Promise<SimilarGameDto[]> {
  if (voterIds.length === 0) return [];
  const [candidates, already, winners] = await Promise.all([
    gameTaste.findSimilar({
      userIds: voterIds,
      limit: CANDIDATE_POOL_SIZE,
      multiplayerOnly: true,
    }),
    loadAlreadyNominatedGameIds(db, lineupId),
    loadRecentWinnerGameIds(db),
  ]);
  return candidates.filter(
    (c) => !already.has(c.gameId) && !winners.has(c.gameId),
  );
}

/**
 * Join candidate gameIds to IDF-weighted top tags and axis dimensions
 * (pulled from the game_taste_vectors row). Helps the prompt builder
 * reason about each candidate without re-querying.
 */
export interface CandidateContext {
  gameId: number;
  name: string;
  coverUrl: string | null;
  similarity: number;
  dimensions: Record<string, number> | null;
}

export async function loadCandidateContext(
  db: Db,
  candidates: SimilarGameDto[],
): Promise<CandidateContext[]> {
  if (candidates.length === 0) return [];
  const ids = candidates.map((c) => c.gameId);
  const rows = await db
    .select({
      gameId: schema.gameTasteVectors.gameId,
      dimensions: schema.gameTasteVectors.dimensions,
    })
    .from(schema.gameTasteVectors)
    .where(inArray(schema.gameTasteVectors.gameId, ids));
  const dimsByGame = new Map<number, Record<string, number>>();
  for (const row of rows) {
    dimsByGame.set(
      row.gameId,
      row.dimensions as unknown as Record<string, number>,
    );
  }
  return candidates.map((c) => ({
    gameId: c.gameId,
    name: c.name,
    coverUrl: c.coverUrl,
    similarity: c.similarity,
    dimensions: dimsByGame.get(c.gameId) ?? null,
  }));
}
