import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SimilarGameDto } from '@raid-ledger/contract';
import type { GameTasteService } from '../../game-taste/game-taste.service';
import * as schema from '../../drizzle/schema';
import type { VoterScopeStrategy } from './voter-scope.helpers';
import {
  loadAllWildcards,
  WILDCARD_POPULAR_SLOTS,
  WILDCARD_SALE_SLOTS,
  type WildcardCandidate,
} from './wildcard.helpers';

/** Tag explaining WHERE a candidate came from (prompt surfaces this). */
export type CandidateOrigin =
  | 'taste_match'
  | 'taste_discovery'
  | 'wildcard_popular'
  | 'wildcard_sale';

/** SimilarGameDto plus its provenance for prompt annotation. */
interface TaggedSimilar extends SimilarGameDto {
  source: CandidateOrigin;
}

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Candidate pool size pulled from the vector ranker before filtering by
 * player count and ownership. Widened (2026-04-22) from 70 → 120 so
 * after removing already-nominated + last-winners + player-count
 * failures we still have enough ownership-diverse candidates to fill
 * a balanced LLM pool.
 */
export const CANDIDATE_POOL_SIZE = 120;

/**
 * How many finalists we hand to the LLM per prompt. Option E curator
 * pattern: the LLM picks 3-7 from this pool, with permission to reject.
 */
export const LLM_POOL_SIZE = 50;

/**
 * Of the taste-matched slice, at least this many must be "discovery
 * picks" (zero community ownership). Otherwise the pool skews heavily
 * toward well-owned games because vector rank correlates with play
 * data, and the LLM's "discovery picks" rule has nothing to choose
 * from.
 */
export const DISCOVERY_POOL_FLOOR = 10;

/** Slots reserved for wildcard candidates (popular + deep-sale). */
export const WILDCARD_POOL_SIZE = WILDCARD_POPULAR_SLOTS + WILDCARD_SALE_SLOTS;

/** Slots allocated to taste-matched candidates (similarity + discovery). */
export const TASTE_POOL_SIZE = LLM_POOL_SIZE - WILDCARD_POOL_SIZE;

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
 * Load community-wide Steam ownership count for each candidate so we
 * can partition the pool into "owned" vs "discovery" before handing
 * it to the LLM. One batched query over all candidate ids.
 */
async function loadCommunityOwnership(
  db: Db,
  gameIds: number[],
): Promise<Map<number, number>> {
  if (gameIds.length === 0) return new Map();
  const rows = await db.execute<{ game_id: number; owner_count: number }>(sql`
    SELECT g.id AS game_id,
           COALESCE(COUNT(*) FILTER (WHERE gi.source = 'steam_library'), 0)::int AS owner_count
    FROM games g
    LEFT JOIN game_interests gi ON gi.game_id = g.id
    WHERE g.id IN (${sql.join(
      gameIds.map((id) => sql`${id}`),
      sql`, `,
    )})
    GROUP BY g.id
  `);
  const map = new Map<number, number>();
  for (const r of rows) map.set(r.game_id, r.owner_count);
  return map;
}

/**
 * Split a similarity-ordered candidate list into the final LLM pool:
 * top-N owned + top-M unowned (discovery), both preserving similarity
 * order. The "owned" bucket is trimmed first so we always reserve the
 * discovery floor even when the similarity top-N is dominated by
 * owned games.
 */
function balanceCandidatePool<T extends { gameId: number }>(
  ordered: T[],
  ownerCounts: Map<number, number>,
  total: number,
  discoveryFloor: number,
): T[] {
  const owned = ordered.filter((c) => (ownerCounts.get(c.gameId) ?? 0) > 0);
  const discovery = ordered.filter((c) => (ownerCounts.get(c.gameId) ?? 0) === 0);
  const discoveryTake = Math.min(discoveryFloor, discovery.length);
  const ownedTake = Math.min(total - discoveryTake, owned.length);
  return [...owned.slice(0, ownedTake), ...discovery.slice(0, discoveryTake)];
}

function tagTasteMatched(
  ordered: SimilarGameDto[],
  ownerCounts: Map<number, number>,
  total: number,
  discoveryFloor: number,
): TaggedSimilar[] {
  const balanced = balanceCandidatePool(
    ordered,
    ownerCounts,
    total,
    discoveryFloor,
  );
  return balanced.map((c) => ({
    ...c,
    source:
      (ownerCounts.get(c.gameId) ?? 0) === 0 ? 'taste_discovery' : 'taste_match',
  }));
}

/**
 * Build the candidate pool fed to the LLM — a blend of taste-matched
 * vector picks, unowned discovery picks, and wildcards (popular +
 * deep-sale) that the vector ranker would never have surfaced.
 *
 *   1. pgvector similarity: top-N games nearest to the voter centroid
 *      (multiplayer-only).
 *   2. Subtract already-nominated + last-3-winners.
 *   3. Filter by player count (private → voter count; public → ≥3).
 *   4. Partition taste-matched slice: majority similarity + reserved
 *      discovery floor (commOwn=0).
 *   5. Wildcards (not taste-matched, serendipity picks): top-N by
 *      total community Steam playtime, and top-N currently on deep
 *      sale. Both filtered by the same player-count rule + multiplayer
 *      tag set. Deduplicated vs the taste-matched slice.
 *   6. Merge + cap at LLM_POOL_SIZE with per-candidate origin tags
 *      surfaced in the prompt.
 */
export async function buildCandidatePool(
  db: Db,
  gameTaste: GameTasteService,
  voterIds: number[],
  lineupId: number,
  strategy: VoterScopeStrategy,
): Promise<TaggedSimilar[]> {
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
  const eligible = passFilters.filter((c) => allowed.has(c.gameId));
  const ownerCounts = await loadCommunityOwnership(
    db,
    eligible.map((c) => c.gameId),
  );
  const tasteMatched = tagTasteMatched(
    eligible,
    ownerCounts,
    TASTE_POOL_SIZE,
    DISCOVERY_POOL_FLOOR,
  );

  // Wildcards come from a separate slice: popular-by-community-hours
  // and deep-sale, both outside the vector-similarity path. We
  // dedupe against taste-matched picks + exclusions so the same
  // game never shows up twice under different banners.
  const tasteMatchedIds = new Set(tasteMatched.map((c) => c.gameId));
  const wildcardExclude = new Set<number>([
    ...already,
    ...winners,
    ...tasteMatchedIds,
  ]);
  const wildcards = await loadAllWildcards(db, wildcardExclude, minPlayers);
  return [...tasteMatched, ...wildcards.slice(0, WILDCARD_POOL_SIZE)];
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
  /** Provenance tag surfaced to the LLM so it can reason about source. */
  source: CandidateOrigin;
  dimensions: Record<string, number> | null;
  /** Voter-scoped ownership count (drives prompt's ownership-bias signal). */
  ownershipCount: number;
  /** Community-wide ownership count (drives "discovery vs owned" signal). */
  communityOwnerCount: number;
  playerCount: { min: number; max: number } | null;
  saleCut: number | null;
  nonOwnerPrice: number | null;
}

/** Row shape returned by the enrichment query. */
interface CandidateMetaRow {
  game_id: number;
  dimensions: Record<string, number> | null;
  ownership_count: number;
  community_owner_count: number;
  player_count: { min: number; max: number } | null;
  sale_cut: number | null;
  non_owner_price: number | null;
}

export async function loadCandidateContext(
  db: Db,
  candidates: TaggedSimilar[],
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
      COALESCE(COUNT(*) FILTER (WHERE gi.source = 'steam_library'), 0)::int AS community_owner_count,
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
      source: c.source,
      dimensions: row?.dimensions ?? null,
      ownershipCount: row?.ownership_count ?? 0,
      communityOwnerCount: row?.community_owner_count ?? 0,
      playerCount: row?.player_count ?? null,
      saleCut: row?.sale_cut ?? null,
      nonOwnerPrice: row?.non_owner_price ?? null,
    };
  });
}

// WildcardCandidate is re-exported via the TaggedSimilar type above;
// anything that imports wildcard types directly can grab them from
// ./wildcard.helpers.
export type { WildcardCandidate };
