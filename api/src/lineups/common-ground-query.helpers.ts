/**
 * Common Ground query helpers (ROK-934 / ROK-950).
 * Builds the SQL query for ownership overlap and maps results. ROK-950
 * extends mapping with a pluggable taste/social/intensity scoring context.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CommonGroundGameDto,
  CommonGroundQueryDto,
  CommonGroundResponseDto,
  CommonGroundScoreBreakdownDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import {
  OWNER_WEIGHT,
  SALE_BONUS,
  FULL_PRICE_PENALTY,
  SCORING_WEIGHTS,
  nominationCap,
  type CommonGroundWeights,
} from './common-ground-scoring.constants';
import {
  computeTasteScore,
  computeSocialScore,
  computeIntensityFit,
  gameToTasteVector,
  type IntensityBucket,
} from './common-ground-taste.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Filters applied to the common ground query. */
export interface CommonGroundFilters {
  minOwners: number;
  maxPlayers?: number;
  genre?: string;
  search?: string;
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
  /** ROK-950: Steam-library owner user IDs for social-score intersection. */
  ownerUserIds: number[];
}

/**
 * Scoring context passed into `mapCommonGroundRow` (ROK-950). All fields
 * are optional — callers that don't care about taste/social/intensity
 * scoring can omit the context entirely and the breakdown will zero those
 * factors.
 */
export interface ScoringContext {
  voterVector: number[] | null;
  coPlayPartnerIds: Set<number>;
  voterIntensity: IntensityBucket | null;
  weights: CommonGroundWeights;
}

/** Build and execute the Common Ground aggregation query. */
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
      g.player_count AS "playerCount",
      COALESCE(
        array_agg(gi.user_id) FILTER (WHERE gi.source = 'steam_library'),
        ARRAY[]::int[]
      ) AS "ownerUserIds"
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
  const conditions = [
    sql`(g.steam_app_id IS NOT NULL OR g.igdb_id IS NOT NULL)`,
  ];

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
    // Excludes games with unknown player count when filter is active
    conditions.push(
      sql`(g.player_count IS NOT NULL AND
        (g.player_count->>'min')::int <= ${filters.maxPlayers}
        AND (g.player_count->>'max')::int >= ${filters.maxPlayers}
      )`,
    );
  }

  if (filters.search) {
    conditions.push(sql`g.name ILIKE ${'%' + filters.search + '%'}`);
  }

  return conditions;
}

/**
 * Legacy scalar scorer kept for back-compat with existing unit tests
 * (ROK-934). Returns the same value as `scoreBreakdown.baseScore` plus
 * sale/full-price adjustment.
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

/** Compute the full per-game score breakdown (ROK-950). */
export function computeScoreBreakdown(
  row: CommonGroundRow,
  ctx: ScoringContext | null,
): CommonGroundScoreBreakdownDto {
  const baseScore = computeScore(row.ownerCount, row.itadCurrentCut);
  if (!ctx) {
    return {
      baseScore,
      tasteScore: 0,
      socialScore: 0,
      intensityScore: 0,
      total: baseScore,
    };
  }
  const gameVec = gameToTasteVector7(row.itadTags);
  const tasteScore = computeTasteScore(
    gameVec,
    ctx.voterVector,
    ctx.weights.tasteWeight,
  );
  const socialScore = computeSocialScore(
    { ownerIds: new Set(row.ownerUserIds ?? []) },
    ctx.coPlayPartnerIds,
    ctx.weights.socialWeight,
  );
  const intensityScore = computeIntensityFit(
    { intensityBucket: deriveGameIntensity(row) },
    ctx.voterIntensity,
    ctx.weights.intensityWeight,
  );
  const total = baseScore + tasteScore + socialScore + intensityScore;
  return { baseScore, tasteScore, socialScore, intensityScore, total };
}

/**
 * Project the full-pool game taste vector down to the 7 pgvector axes so
 * it can be multiplied against the stored voter vector (`vector(7)`).
 */
function gameToTasteVector7(itadTags: string[]): number[] {
  const pool = gameToTasteVector(itadTags);
  // Match stored pgvector column order: co_op, pvp, rpg, survival, strategy, social, mmo.
  // Indices in TASTE_PROFILE_AXIS_POOL (declared in contract): 0, 1, 9, 14, 13, 19, 3.
  return [pool[0], pool[1], pool[9], pool[14], pool[13], pool[19], pool[3]];
}

/**
 * Intensity bucket derived from `games.playerCount.max` (ROK-1089).
 * IGDB's mapper normalizes `min` to 1, so `max` is the principled signal:
 * solo/1-on-1 (≤2) → low, small-party co-op (3–8) → medium, raid/MMO/
 * competitive-sized (≥9) → high. Returns `null` when player count is
 * unknown to preserve graceful degradation in `computeIntensityFit`.
 */
export function deriveGameIntensity(
  row: CommonGroundRow,
): IntensityBucket | null {
  if (row.playerCount === null) return null;
  const { max } = row.playerCount;
  if (max <= 2) return 'low';
  if (max <= 8) return 'medium';
  return 'high';
}

/**
 * Map a raw DB row to a scored CommonGroundGameDto. When `ctx` is supplied
 * the breakdown is populated with taste/social/intensity factors; the
 * top-level `score` field stays equal to `breakdown.total` for callers
 * that ignore the breakdown.
 */
export function mapCommonGroundRow(
  row: CommonGroundRow,
  ctx: ScoringContext | null = null,
): CommonGroundGameDto {
  const safeRow: CommonGroundRow = {
    ...row,
    itadTags: Array.isArray(row.itadTags) ? row.itadTags : [],
    ownerUserIds: Array.isArray(row.ownerUserIds) ? row.ownerUserIds : [],
  };
  const breakdown = computeScoreBreakdown(safeRow, ctx);
  return {
    gameId: safeRow.gameId,
    gameName: safeRow.gameName,
    slug: safeRow.slug,
    coverUrl: safeRow.coverUrl,
    ownerCount: safeRow.ownerCount,
    wishlistCount: safeRow.wishlistCount,
    nonOwnerPrice: safeRow.nonOwnerPrice,
    itadCurrentCut: safeRow.itadCurrentCut,
    itadCurrentShop: safeRow.itadCurrentShop,
    itadCurrentUrl: safeRow.itadCurrentUrl,
    earlyAccess: safeRow.earlyAccess,
    itadTags: safeRow.itadTags,
    playerCount: safeRow.playerCount,
    score: breakdown.total,
    scoreBreakdown: breakdown,
  };
}

/** Build the full Common Ground response from DB. */
export async function buildCommonGroundResponse(
  db: Db,
  lineupId: number,
  nominatedIds: number[],
  nominatorCount: number,
  filters: CommonGroundQueryDto,
  ctx: ScoringContext | null = null,
): Promise<CommonGroundResponseDto> {
  const rows = await queryCommonGround(db, filters, nominatedIds);
  const scored = rows.map((r) => mapCommonGroundRow(r, ctx));
  scored.sort((a, b) => b.score - a.score);
  const weights = ctx?.weights ?? { ...SCORING_WEIGHTS };
  return {
    data: scored,
    meta: {
      total: scored.length,
      appliedWeights: {
        ownerWeight: weights.ownerWeight,
        saleBonus: weights.saleBonus,
        fullPricePenalty: weights.fullPricePenalty,
        tasteWeight: weights.tasteWeight,
        socialWeight: weights.socialWeight,
        intensityWeight: weights.intensityWeight,
      },
      activeLineupId: lineupId,
      nominatedCount: nominatedIds.length,
      maxNominations: nominationCap(nominatorCount),
    },
  };
}
