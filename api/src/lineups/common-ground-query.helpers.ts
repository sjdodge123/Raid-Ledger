/**
 * Common Ground query helpers (ROK-934).
 * Builds the SQL query for ownership overlap and maps results.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CommonGroundGameDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import {
  OWNER_WEIGHT,
  SALE_BONUS,
  FULL_PRICE_PENALTY,
} from './common-ground-scoring.constants';

/** Filters applied to the common ground query. */
export interface CommonGroundFilters {
  minOwners: number;
  maxPlayers?: number;
  genre?: string;
  limit: number;
}

/** Raw row returned from the aggregation query. */
export interface CommonGroundRow {
  gameId: number;
  gameName: string;
  slug: string;
  coverUrl: string | null;
  ownerCount: number;
  wishlistCount: number;
  nonOwnerPrice: number | null;
  itadCurrentCut: number | null;
  itadCurrentShop: string | null;
  itadCurrentUrl: string | null;
  earlyAccess: boolean;
  itadTags: string[];
  playerCount: { min: number; max: number } | null;
}

/**
 * Build and execute the Common Ground aggregation query.
 * @returns Raw rows before scoring.
 */
export async function queryCommonGround(
  db: PostgresJsDatabase<typeof schema>,
  filters: CommonGroundFilters,
  excludeGameIds: number[],
): Promise<CommonGroundRow[]> {
  const conditions = buildWhereConditions(filters, excludeGameIds);

  const rows = (await db.execute(sql`
    SELECT
      g.id AS "gameId",
      g.name AS "gameName",
      g.slug,
      g.cover_url AS "coverUrl",
      COALESCE(COUNT(*) FILTER (WHERE gi.source = 'steam_library'), 0)::int AS "ownerCount",
      COALESCE(COUNT(*) FILTER (WHERE gi.source = 'steam_wishlist'), 0)::int AS "wishlistCount",
      CASE WHEN g.itad_current_price IS NOT NULL THEN g.itad_current_price::float ELSE NULL END AS "nonOwnerPrice",
      g.itad_current_cut AS "itadCurrentCut",
      g.itad_current_shop AS "itadCurrentShop",
      g.itad_current_url AS "itadCurrentUrl",
      g.early_access AS "earlyAccess",
      COALESCE(g.itad_tags, '[]'::jsonb) AS "itadTags",
      g.player_count AS "playerCount"
    FROM games g
    LEFT JOIN game_interests gi ON gi.game_id = g.id
    WHERE ${sql.join(conditions, sql` AND `)}
    GROUP BY g.id
    HAVING COALESCE(COUNT(*) FILTER (WHERE gi.source = 'steam_library'), 0) >= ${filters.minOwners}
    ORDER BY COALESCE(COUNT(*) FILTER (WHERE gi.source = 'steam_library'), 0) DESC
    LIMIT ${filters.limit}
  `)) as unknown as CommonGroundRow[];

  return rows;
}

/** Build WHERE conditions from filters. */
function buildWhereConditions(
  filters: CommonGroundFilters,
  excludeGameIds: number[],
): ReturnType<typeof sql>[] {
  const conditions = [sql`1=1`];

  if (excludeGameIds.length > 0) {
    conditions.push(
      sql`g.id NOT IN (${sql.join(
        excludeGameIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  }

  if (filters.genre) {
    conditions.push(
      sql`g.itad_tags @> ${JSON.stringify([filters.genre])}::jsonb`,
    );
  }

  if (filters.maxPlayers != null) {
    // Show games that SUPPORT this many players: min <= N <= max
    // Games with null player_count are included (unknown = assumed compatible)
    conditions.push(
      sql`(g.player_count IS NULL OR (
        (g.player_count->>'min')::int <= ${filters.maxPlayers}
        AND (g.player_count->>'max')::int >= ${filters.maxPlayers}
      ))`,
    );
  }

  return conditions;
}

/**
 * Compute the Common Ground score for a game.
 * @param ownerCount - Number of library owners
 * @param currentCut - Current discount percentage (0-100), null if unknown
 * @returns Numeric score
 */
export function computeScore(
  ownerCount: number,
  currentCut: number | null,
): number {
  const ownerScore = ownerCount * OWNER_WEIGHT;
  const saleAdjustment =
    currentCut != null && currentCut > 0 ? SALE_BONUS : -FULL_PRICE_PENALTY;
  return ownerScore + saleAdjustment;
}

/** Map a raw DB row to a scored CommonGroundGameDto. */
export function mapCommonGroundRow(row: CommonGroundRow): CommonGroundGameDto {
  return {
    ...row,
    itadTags: Array.isArray(row.itadTags) ? row.itadTags : [],
    playerCount: row.playerCount as { min: number; max: number } | null,
    score: computeScore(row.ownerCount, row.itadCurrentCut),
  };
}
