/**
 * The shared Common Ground projection (ROK-1538).
 *
 * Split out of `common-ground-query.helpers.ts` to keep that file under the
 * 300-line cap, and — more importantly — so the filtered pool query and the
 * cohort row's by-id lookup read the SAME columns through the SAME SQL body.
 * Two divergent copies of this projection would hand the client two subtly
 * different card shapes depending on which row a game landed in.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import type { CommonGroundRow } from './common-ground-query.helpers';

/**
 * The SELECT/FROM/GROUP BY body shared by every Common Ground read.
 *
 * Extracted (ROK-1538) so the cohort row can enrich a remembered game that
 * the filtered pool query never returned WITHOUT a second, divergent copy of
 * this projection. Both call sites therefore produce byte-identical
 * `CommonGroundRow`s and map through the same `mapCommonGroundRow`.
 */
export function commonGroundSelect(
  where: ReturnType<typeof sql>,
  tail: ReturnType<typeof sql>,
): ReturnType<typeof sql> {
  return sql`
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
      CASE WHEN g.itad_lowest_price IS NOT NULL THEN g.itad_lowest_price::float ELSE NULL END AS "itadLowestPrice",
      g.early_access AS "earlyAccess",
      COALESCE(g.itad_tags, '[]'::jsonb) AS "itadTags",
      g.player_count AS "playerCount",
      g.cooptimus_online_max AS "cooptimusOnlineMax",
      g.cooptimus_couch_max AS "cooptimusCouchMax",
      g.cooptimus_combo_coop AS "cooptimusComboCoop",
      COALESCE(g.genres, '[]'::jsonb) AS "genres",
      g.rating AS "rating",
      g.aggregated_rating AS "aggregatedRating",
      COALESCE(g.game_modes, '[]'::jsonb) AS "gameModes",
      COALESCE(
        array_agg(gi.user_id) FILTER (WHERE gi.source = 'steam_library'),
        ARRAY[]::int[]
      ) AS "ownerUserIds",
      COALESCE(
        array_agg(gi.user_id) FILTER (WHERE gi.source = 'steam_wishlist'),
        ARRAY[]::int[]
      ) AS "wishlistUserIds"
    FROM games g
    LEFT JOIN game_interests gi ON gi.game_id = g.id
    WHERE ${where}
    GROUP BY g.id
    ${tail}
  `;
}

/**
 * Read specific games by id, bypassing every pool filter (ROK-1538).
 *
 * The cohort row must surface a game the group already resolved even when it
 * fails `minOwners`, the genre/search/player filters or the pool LIMIT —
 * "you played this together" is a historical fact, not a recommendation the
 * filters get a vote on. No HAVING, no LIMIT; the caller has already bounded
 * the id list by what cohort memory returned.
 */
export async function queryCommonGroundByGameIds(
  db: PostgresJsDatabase<typeof schema>,
  gameIds: number[],
): Promise<CommonGroundRow[]> {
  if (gameIds.length === 0) return [];
  const rows = (await db.execute(
    commonGroundSelect(
      sql`g.id IN (${sql.join(
        gameIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
      sql`ORDER BY g.name ASC`,
    ),
  )) as unknown as CommonGroundRow[];
  return rows;
}
