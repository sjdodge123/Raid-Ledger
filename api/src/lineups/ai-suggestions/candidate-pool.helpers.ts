import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SimilarGameDto } from '@raid-ledger/contract';
import type { GameTasteService } from '../../game-taste/game-taste.service';
import * as schema from '../../drizzle/schema';
import type { VoterScopeStrategy } from './voter-scope.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Candidate pool size pulled from the vector ranker before filtering by
 * player count and ownership. Slightly wider than the 30 we feed the
 * LLM so we can afford to drop a few that fail the player-count rule.
 */
export const CANDIDATE_POOL_SIZE = 40;

/** How many finalists we hand to the LLM per prompt. */
export const LLM_POOL_SIZE = 30;

/** How many past winners we exclude (spec: last-3-winners). */
const RECENT_WINNER_WINDOW = 3;

/**
 * Community-wide floor — any public or fallback lineup suggestion must
 * support at least this many players. Keeps community picks group-
 * viable by default even when the voter set is sparse.
 */
const COMMUNITY_PLAYER_FLOOR = 3;

/**
 * Compute the minimum `playerCount.max` required to accept a candidate.
 *   private lineup   → at least `voterCount` (everyone fits)
 *   public / fallback → max(3, voterCount) so the pick is still
 *                        group-viable even with a thin voter set
 */
export function minimumPlayerCount(
  voterCount: number,
  strategy: VoterScopeStrategy,
): number {
  // Private invitee sets resolve to `small_group` too when small, but
  // voter-scope.helpers.ts sets strategy from COUNT — not privacy. We
  // rely on the "explicit voterCount" for private-lineup sizing and
  // fall back to COMMUNITY_PLAYER_FLOOR for bigger / fallback pools.
  if (voterCount <= 0) return COMMUNITY_PLAYER_FLOOR;
  if (strategy === 'small_group') return Math.max(voterCount, 2);
  return Math.max(voterCount, COMMUNITY_PLAYER_FLOOR);
}

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
 * Check whether a game's `playerCount.max` meets the requirement.
 * Games with null or missing player_count fail closed — we can't
 * guarantee they support the group size, so the LLM never sees them.
 */
async function filterByPlayerCount(
  db: Db,
  gameIds: number[],
  minPlayerCount: number,
): Promise<Set<number>> {
  if (gameIds.length === 0) return new Set();
  const rows = await db.execute<{ game_id: number }>(sql`
    SELECT g.id AS game_id
    FROM games g
    WHERE g.id IN (${sql.join(
      gameIds.map((id) => sql`${id}`),
      sql`, `,
    )})
      AND g.player_count IS NOT NULL
      AND (g.player_count->>'max')::int >= ${minPlayerCount}
  `);
  return new Set(rows.map((r) => r.game_id));
}

/**
 * Build the candidate pool fed to the LLM.
 *
 *   1. pgvector similarity: top-N games nearest to the voter centroid
 *      (multiplayer-only — Community Lineup is group play).
 *   2. Subtract games already nominated on this lineup.
 *   3. Subtract games that won any of the last 3 decided lineups.
 *   4. Filter by player count: require `playerCount.max >= min`
 *      (private → voter count; public/fallback → max(3, voterCount)).
 *   5. Truncate to LLM_POOL_SIZE.
 */
export async function buildCandidatePool(
  db: Db,
  gameTaste: GameTasteService,
  voterIds: number[],
  lineupId: number,
  strategy: VoterScopeStrategy,
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
  const passFilters = candidates.filter(
    (c) => !already.has(c.gameId) && !winners.has(c.gameId),
  );
  const minPlayers = minimumPlayerCount(voterIds.length, strategy);
  const allowed = await filterByPlayerCount(
    db,
    passFilters.map((c) => c.gameId),
    minPlayers,
  );
  return passFilters.filter((c) => allowed.has(c.gameId)).slice(0, LLM_POOL_SIZE);
}

/**
 * Per-candidate signals the LLM uses to reason about fit — axis
 * dimensions, per-voter ownership counts, current sale info, player
 * count. Loading all of this once keeps the prompt builder side-effect
 * free.
 */
export interface CandidateContext {
  gameId: number;
  name: string;
  coverUrl: string | null;
  similarity: number;
  dimensions: Record<string, number> | null;
  ownershipCount: number;
  playerCount: { min: number; max: number } | null;
  saleCut: number | null;
  nonOwnerPrice: number | null;
}

/** Row shape returned by the enrichment query. */
interface CandidateMetaRow {
  game_id: number;
  dimensions: Record<string, number> | null;
  ownership_count: number;
  player_count: { min: number; max: number } | null;
  sale_cut: number | null;
  non_owner_price: number | null;
}

export async function loadCandidateContext(
  db: Db,
  candidates: SimilarGameDto[],
  voterIds: number[],
): Promise<CandidateContext[]> {
  if (candidates.length === 0) return [];
  const ids = candidates.map((c) => c.gameId);
  const voterFilter =
    voterIds.length > 0
      ? sql`AND gi.user_id IN (${sql.join(
          voterIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql`AND FALSE`;
  const rows = (await db.execute(sql`
    SELECT
      g.id AS game_id,
      gtv.dimensions AS dimensions,
      COALESCE(COUNT(*) FILTER (WHERE gi.source = 'steam_library' ${voterFilter}), 0)::int AS ownership_count,
      g.player_count AS player_count,
      g.itad_current_cut AS sale_cut,
      CASE WHEN g.itad_current_price IS NOT NULL THEN g.itad_current_price::float ELSE NULL END AS non_owner_price
    FROM games g
    LEFT JOIN game_taste_vectors gtv ON gtv.game_id = g.id
    LEFT JOIN game_interests gi ON gi.game_id = g.id
    WHERE g.id IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})
    GROUP BY g.id, gtv.dimensions
  `)) as unknown as CandidateMetaRow[];
  const rowById = new Map(rows.map((r) => [r.game_id, r]));
  return candidates.map((c) => {
    const row = rowById.get(c.gameId);
    return {
      gameId: c.gameId,
      name: c.name,
      coverUrl: c.coverUrl,
      similarity: c.similarity,
      dimensions: row?.dimensions ?? null,
      ownershipCount: row?.ownership_count ?? 0,
      playerCount: row?.player_count ?? null,
      saleCut: row?.sale_cut ?? null,
      nonOwnerPrice: row?.non_owner_price ?? null,
    };
  });
}
