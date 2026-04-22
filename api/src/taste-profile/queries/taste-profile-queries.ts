import { eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type {
  ArchetypeDto,
  IntensityMetricsDto,
  IntensityTier,
  TasteProfileDimensionsDto,
  TasteProfilePoolAxis,
} from '@raid-ledger/contract';
import { TASTE_PROFILE_AXIS_POOL } from '@raid-ledger/contract';
import { TIER_DESCRIPTIONS } from '../archetype-copy';

type Db = PostgresJsDatabase<typeof schema>;

export interface CoPlayPartnerRow {
  userId: number;
  username: string;
  avatar: string | null;
  sessionCount: number;
  totalMinutes: number;
  lastPlayedAt: string;
}

export interface TasteProfileResult {
  userId: number;
  dimensions: TasteProfileDimensionsDto;
  intensityMetrics: {
    intensity: number;
    focus: number;
    breadth: number;
    consistency: number;
  };
  archetype: ArchetypeDto;
  coPlayPartners: CoPlayPartnerRow[];
  computedAt: string;
}

export interface SimilarPlayerRow {
  userId: number;
  username: string;
  avatar: string | null;
  intensityTier: IntensityTier;
  similarity: number;
}

/**
 * Default archetype for users without a computed taste vector (or whose
 * jsonb archetype is still NULL immediately after the 0127 migration).
 * Matches the composed `ArchetypeDto` shape with no vector titles so the
 * UI renders an intensity-only badge ("Casual Player").
 */
function emptyArchetype(): ArchetypeDto {
  return {
    intensityTier: 'Casual',
    vectorTitles: [],
    descriptions: {
      tier: TIER_DESCRIPTIONS.Casual,
      titles: [],
    },
  };
}

export async function getTasteProfile(
  db: Db,
  userId: number,
): Promise<TasteProfileResult | null> {
  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (user.length === 0) return null;

  const vec = await db
    .select()
    .from(schema.playerTasteVectors)
    .where(eq(schema.playerTasteVectors.userId, userId))
    .limit(1);

  const coPlayPartners = await topCoPlayPartners(db, userId);
  const now = new Date().toISOString();

  if (vec.length === 0) {
    return {
      userId,
      dimensions: zeroedDimensions(),
      intensityMetrics: { intensity: 0, focus: 0, breadth: 0, consistency: 0 },
      archetype: emptyArchetype(),
      coPlayPartners,
      computedAt: now,
    };
  }

  const row = vec[0];
  return {
    userId,
    dimensions: row.dimensions,
    intensityMetrics: row.intensityMetrics,
    // ROK-1083: archetype column is nullable jsonb post-migration; a NULL
    // value means the cron has not yet rebuilt the row. Fall through to
    // the composed Casual default until the next `runAggregateVectors`.
    archetype: row.archetype ?? emptyArchetype(),
    coPlayPartners,
    computedAt: row.computedAt.toISOString(),
  };
}

export async function findSimilarPlayers(
  db: Db,
  userId: number,
  limit: number,
): Promise<SimilarPlayerRow[]> {
  const clamped = Math.max(1, Math.min(limit, 50));
  const anchor = await db
    .select()
    .from(schema.playerTasteVectors)
    .where(eq(schema.playerTasteVectors.userId, userId))
    .limit(1);
  if (anchor.length === 0) return [];

  const anchorVector = `[${anchor[0].vector.join(',')}]`;
  // ROK-1083: archetype is now jsonb — extract intensityTier via
  // `->>'intensityTier'` so we still ship the compact tier string on
  // similar-player cards without parsing the whole payload client-side.
  const rows = await db.execute<{
    user_id: number;
    username: string;
    avatar: string | null;
    intensity_tier: IntensityTier | null;
    distance: string;
  }>(sql`
    SELECT v.user_id, u.username, u.avatar,
           (v.archetype->>'intensityTier')::text AS intensity_tier,
           (v.vector <=> ${anchorVector}::vector) AS distance
    FROM player_taste_vectors v
    JOIN users u ON u.id = v.user_id
    WHERE v.user_id <> ${userId}
    ORDER BY distance ASC
    LIMIT ${clamped}
  `);

  return rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    avatar: r.avatar,
    intensityTier: r.intensity_tier ?? 'Casual',
    similarity: Math.max(0, 1 - Number(r.distance)),
  }));
}

async function topCoPlayPartners(
  db: Db,
  userId: number,
): Promise<CoPlayPartnerRow[]> {
  const rows = await db.execute<{
    user_id: number;
    username: string;
    avatar: string | null;
    session_count: number;
    total_minutes: number;
    last_played_at: Date | string;
  }>(sql`
    SELECT
      CASE WHEN user_id_a = ${userId} THEN user_id_b ELSE user_id_a END AS user_id,
      u.username, u.avatar, p.session_count, p.total_minutes, p.last_played_at
    FROM player_co_play p
    JOIN users u ON u.id = CASE WHEN user_id_a = ${userId} THEN user_id_b ELSE user_id_a END
    WHERE user_id_a = ${userId} OR user_id_b = ${userId}
    ORDER BY p.session_count DESC, p.total_minutes DESC
    LIMIT 10
  `);
  return rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    avatar: r.avatar,
    sessionCount: r.session_count,
    totalMinutes: r.total_minutes,
    lastPlayedAt:
      r.last_played_at instanceof Date
        ? r.last_played_at.toISOString()
        : new Date(r.last_played_at).toISOString(),
  }));
}

function zeroedDimensions(): TasteProfileDimensionsDto {
  const dims = {} as Record<TasteProfilePoolAxis, number>;
  for (const axis of TASTE_PROFILE_AXIS_POOL) dims[axis] = 0;
  return dims as TasteProfileDimensionsDto;
}

/** Lightweight vector record for Common Ground scoring (ROK-950). */
export interface TasteVectorRow {
  userId: number;
  vector: number[];
  intensityMetrics: IntensityMetricsDto;
}

/**
 * Batched vector lookup for scoring contexts (ROK-950). Missing users are
 * simply absent from the map — callers decide whether to treat that as an
 * error or a graceful skip.
 */
export async function getTasteVectorsForUsers(
  db: Db,
  userIds: number[],
): Promise<Map<number, TasteVectorRow>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({
      userId: schema.playerTasteVectors.userId,
      vector: schema.playerTasteVectors.vector,
      intensityMetrics: schema.playerTasteVectors.intensityMetrics,
    })
    .from(schema.playerTasteVectors)
    .where(inArray(schema.playerTasteVectors.userId, userIds));
  const map = new Map<number, TasteVectorRow>();
  for (const row of rows) {
    map.set(row.userId, {
      userId: row.userId,
      vector: row.vector,
      intensityMetrics: row.intensityMetrics,
    });
  }
  return map;
}
