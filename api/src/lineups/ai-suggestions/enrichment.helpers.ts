import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  AiSuggestionDto,
  AiSuggestionsLlmOutputDto,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

interface GameRow {
  id: number;
  name: string;
  coverUrl: string | null;
}

async function loadGames(db: Db, gameIds: number[]): Promise<GameRow[]> {
  if (gameIds.length === 0) return [];
  const rows = await db
    .select({
      id: schema.games.id,
      name: schema.games.name,
      coverUrl: schema.games.coverUrl,
    })
    .from(schema.games)
    .where(inArray(schema.games.id, gameIds));
  return rows;
}

/**
 * Count how many of the voter set own each candidate game. Ownership
 * rides on `game_interests.source = 'steam_library'` — the same signal
 * `lineups-enrichment.helpers.ts` uses for Common Ground overlap.
 * Returns a `gameId -> count` map with zeros for games that nobody owns.
 */
async function loadOwnershipCounts(
  db: Db,
  gameIds: number[],
  voterIds: number[],
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  for (const id of gameIds) out.set(id, 0);
  if (gameIds.length === 0 || voterIds.length === 0) return out;
  const rows = await db
    .select({
      gameId: schema.gameInterests.gameId,
      count: sql<number>`count(distinct ${schema.gameInterests.userId})::int`,
    })
    .from(schema.gameInterests)
    .where(
      and(
        inArray(schema.gameInterests.gameId, gameIds),
        inArray(schema.gameInterests.userId, voterIds),
        eq(schema.gameInterests.source, 'steam_library'),
      ),
    )
    .groupBy(schema.gameInterests.gameId);
  for (const row of rows) out.set(row.gameId, Number(row.count));
  return out;
}

/**
 * Merge the LLM's `{gameId, confidence, reasoning}` list with
 * server-side metadata (name, cover, ownership count, voter total) to
 * produce the response DTO shape. Drops suggestions whose `gameId`
 * isn't in the candidate pool's known game set.
 */
export async function enrichSuggestions(
  db: Db,
  llmOutput: AiSuggestionsLlmOutputDto,
  knownGameIds: Set<number>,
  voterIds: number[],
): Promise<AiSuggestionDto[]> {
  const filtered = llmOutput.suggestions.filter((s) =>
    knownGameIds.has(s.gameId),
  );
  if (filtered.length === 0) return [];
  const ids = filtered.map((s) => s.gameId);
  const [games, ownershipById] = await Promise.all([
    loadGames(db, ids),
    loadOwnershipCounts(db, ids, voterIds),
  ]);
  const gameById = new Map(games.map((g) => [g.id, g]));
  const voterTotal = voterIds.length;
  return filtered
    .filter((s) => gameById.has(s.gameId))
    .map((s) => {
      const game = gameById.get(s.gameId);
      if (!game) throw new Error(`Game ${s.gameId} missing after filter`);
      return {
        gameId: s.gameId,
        name: game.name,
        coverUrl: game.coverUrl,
        confidence: s.confidence,
        reasoning: s.reasoning,
        ownershipCount: ownershipById.get(s.gameId) ?? 0,
        voterTotal,
      };
    });
}
