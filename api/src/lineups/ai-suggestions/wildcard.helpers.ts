import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SimilarGameDto } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Non-taste-matched candidates slipped into the LLM pool so the
 * curator can "mix things up" — serendipitous options the vector
 * ranker would never have surfaced.
 *
 * Two flavours:
 *   - `wildcard_popular` — games with the highest total community
 *     Steam playtime (lifetime minutes summed across all voters). The
 *     reasoning: "these are titles the community has collectively
 *     sunk hours into; worth spotlighting even if they don't match
 *     the group's taste axes perfectly."
 *   - `wildcard_sale`    — games currently on a deep discount (≥50%
 *     off). The reasoning: "strong opportunistic pick if it lands —
 *     if the group picks it up tonight, the floor cost is minimal."
 *
 * Both filters respect the group-size floor (`player_count.max ≥
 * minPlayerCount`) and the multiplayer requirement (via ITAD tag
 * overlap — separate from the `game_taste_vectors.dimensions` path
 * because wildcards may not have a vector row at all).
 */
export type WildcardSource = 'wildcard_popular' | 'wildcard_sale';

export interface WildcardCandidate extends SimilarGameDto {
  source: WildcardSource;
}

/** ITAD tags that indicate multiplayer capability. */
const MULTIPLAYER_TAGS = [
  'Multiplayer',
  'Co-op',
  'Online Co-Op',
  'Local Co-Op',
  'PvP',
  'MMO',
  'Massively Multiplayer',
  'Online PvP',
  'Cross-Platform Multiplayer',
];

/** How many wildcards of each type to add to the LLM pool. */
export const WILDCARD_POPULAR_SLOTS = 5;
export const WILDCARD_SALE_SLOTS = 5;

/** Minimum sale cut (%) for a candidate to qualify as a sale wildcard. */
const SALE_WILDCARD_MIN_CUT = 50;

function multiplayerTagClause() {
  return sql`g.itad_tags ?| ${sql.raw(
    `ARRAY[${MULTIPLAYER_TAGS.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')}]`,
  )}`;
}

function excludeClause(excludeGameIds: ReadonlySet<number>) {
  if (excludeGameIds.size === 0) return sql`TRUE`;
  const ids = Array.from(excludeGameIds);
  return sql`g.id NOT IN (${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`;
}

/**
 * Top-N games by total community Steam playtime. "Popular" in the
 * sense of "the community has put hours into this" — a different
 * signal from taste-vector similarity. Excludes games already in
 * the exclude set (nominated, recent winners, or already in the
 * taste-matched pool).
 */
export async function loadPopularWildcards(
  db: Db,
  excludeGameIds: ReadonlySet<number>,
  minPlayerCount: number,
  limit: number = WILDCARD_POPULAR_SLOTS,
): Promise<WildcardCandidate[]> {
  const rows = await db.execute<{
    game_id: number;
    name: string;
    cover_url: string | null;
    total_minutes: number;
  }>(sql`
    SELECT g.id AS game_id,
           g.name AS name,
           g.cover_url AS cover_url,
           COALESCE(SUM(gi.playtime_forever), 0)::int AS total_minutes
    FROM games g
    LEFT JOIN game_interests gi
      ON gi.game_id = g.id AND gi.source = 'steam_library'
    WHERE g.banned = false
      AND g.hidden = false
      AND g.player_count IS NOT NULL
      AND (g.player_count->>'max')::int >= ${minPlayerCount}
      AND ${multiplayerTagClause()}
      AND ${excludeClause(excludeGameIds)}
    GROUP BY g.id
    HAVING COALESCE(SUM(gi.playtime_forever), 0) > 0
    ORDER BY total_minutes DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    gameId: r.game_id,
    name: r.name,
    coverUrl: r.cover_url,
    similarity: 0,
    source: 'wildcard_popular' as const,
  }));
}

/**
 * Top-N games currently on a deep discount (≥50% off). The sale cut
 * drives ordering (steepest first).
 */
export async function loadSaleWildcards(
  db: Db,
  excludeGameIds: ReadonlySet<number>,
  minPlayerCount: number,
  limit: number = WILDCARD_SALE_SLOTS,
): Promise<WildcardCandidate[]> {
  const rows = await db.execute<{
    game_id: number;
    name: string;
    cover_url: string | null;
    sale_cut: number;
  }>(sql`
    SELECT g.id AS game_id,
           g.name AS name,
           g.cover_url AS cover_url,
           g.itad_current_cut AS sale_cut
    FROM games g
    WHERE g.banned = false
      AND g.hidden = false
      AND g.player_count IS NOT NULL
      AND (g.player_count->>'max')::int >= ${minPlayerCount}
      AND g.itad_current_cut >= ${SALE_WILDCARD_MIN_CUT}
      AND ${multiplayerTagClause()}
      AND ${excludeClause(excludeGameIds)}
    ORDER BY g.itad_current_cut DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    gameId: r.game_id,
    name: r.name,
    coverUrl: r.cover_url,
    similarity: 0,
    source: 'wildcard_sale' as const,
  }));
}

/**
 * Load both wildcard flavours and deduplicate by gameId (the same
 * game can technically be both popular and on sale). Tags stay with
 * the first flavour a given game shows up under — popular wins ties.
 */
export async function loadAllWildcards(
  db: Db,
  excludeGameIds: ReadonlySet<number>,
  minPlayerCount: number,
): Promise<WildcardCandidate[]> {
  const [popular, sale] = await Promise.all([
    loadPopularWildcards(db, excludeGameIds, minPlayerCount),
    loadSaleWildcards(db, excludeGameIds, minPlayerCount),
  ]);
  const seen = new Set<number>();
  const out: WildcardCandidate[] = [];
  for (const c of [...popular, ...sale]) {
    if (seen.has(c.gameId)) continue;
    seen.add(c.gameId);
    out.push(c);
  }
  return out;
}
