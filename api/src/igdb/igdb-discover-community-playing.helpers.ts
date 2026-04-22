/**
 * "Your Community Has Been Playing" discover row (ROK-565).
 *
 * Unifies three activity sources over the last 14 days — Discord presence
 * rollups, Steam library 2-week playtime, and attended event durations —
 * into a single row ranked by COUNT(DISTINCT user_id) desc, SUM(seconds) desc.
 *
 * Lives in its own file because the CTE + metadata shaping would push
 * igdb-discover.helpers.ts past its 300-line soft limit (architect guidance #6).
 */
import { and, inArray, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import {
  GameDetailDto,
  GameDiscoverRowDto,
  GameDiscoverRowMetadataEntryDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { mapDbRowToDetail } from './igdb.mappers';
import { VISIBILITY_FILTER } from './igdb-visibility.helpers';
import type { DiscoverCategory } from './igdb-discover.helpers';

const CACHE_KEY = 'games:discover:community-has-been-playing';
const ROW_LIMIT = 20;

type MetadataMap = Record<string, GameDiscoverRowMetadataEntryDto>;

interface CommunityPlayingPayload {
  games: GameDetailDto[];
  metadata: MetadataMap;
}

// db.execute(sql``) on postgres-js returns bigint as a string.
export type CommunityPlayingRow = {
  game_id: number;
  player_count: number;
  total_seconds: string;
};

// Cache payload differs from fetchCategoryRow — stores { games, metadata }
// because this row has per-game stats (ROK-565 architect guidance #1).
async function tryCommunityPlayingCache(
  redis: Redis,
): Promise<CommunityPlayingPayload | null> {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return JSON.parse(cached) as CommunityPlayingPayload;
  } catch {
    /* Redis miss */
  }
  return null;
}

async function setCommunityPlayingCache(
  redis: Redis,
  payload: CommunityPlayingPayload,
  cacheTtl: number,
): Promise<void> {
  try {
    await redis.setex(CACHE_KEY, cacheTtl, JSON.stringify(payload));
  } catch {
    /* Non-fatal */
  }
}

// Privacy behavior mirrors PRIVACY_FILTER in igdb-activity.helpers.ts —
// duplicated because this CTE uses raw sql`` (ROK-565 architect guidance #2).
const COMMUNITY_PLAYING_QUERY = sql`
  WITH discord_activity AS (
    SELECT user_id, game_id, SUM(total_seconds)::bigint AS seconds
    FROM game_activity_rollups
    WHERE period = 'day'
      AND period_start >= (NOW() - INTERVAL '14 days')::date
    GROUP BY user_id, game_id
  ),
  steam_activity AS (
    SELECT user_id, game_id, (COALESCE(playtime_2weeks, 0) * 60)::bigint AS seconds
    FROM game_interests
    WHERE source = 'steam_library'
      AND playtime_2weeks IS NOT NULL
      AND playtime_2weeks > 0
  ),
  -- TODO(ROK-565-followup): long raids contribute more seconds than short sessions.
  -- Acceptable for v1 because primary sort is COUNT(DISTINCT user_id); revisit if
  -- operator reports ranking skew.
  event_attendance AS (
    SELECT s.user_id, e.game_id,
           EXTRACT(EPOCH FROM (upper(e.duration) - lower(e.duration)))::bigint AS seconds
    FROM event_signups s
    INNER JOIN events e ON e.id = s.event_id
    WHERE s.attendance_status = 'attended'
      AND s.user_id IS NOT NULL
      AND e.game_id IS NOT NULL
      AND e.cancelled_at IS NULL
      AND upper(e.duration) >= (NOW() - INTERVAL '14 days')
      AND upper(e.duration) <= NOW()
  ),
  combined AS (
    SELECT user_id, game_id, SUM(seconds)::bigint AS seconds
    FROM (
      SELECT * FROM discord_activity
      UNION ALL SELECT * FROM steam_activity
      UNION ALL SELECT * FROM event_attendance
    ) u
    GROUP BY user_id, game_id
  ),
  filtered AS (
    SELECT c.* FROM combined c
    WHERE NOT EXISTS (
      SELECT 1 FROM user_preferences p
      WHERE p.user_id = c.user_id
        AND p.key = 'show_activity'
        AND p.value = 'false'::jsonb
    )
  )
  SELECT game_id,
         COUNT(DISTINCT user_id)::int AS player_count,
         SUM(seconds)::bigint AS total_seconds
  FROM filtered
  GROUP BY game_id
  ORDER BY player_count DESC, total_seconds DESC
  LIMIT ${sql.raw(String(ROW_LIMIT))}
`;

/** Run the unified CTE. bigint `total_seconds` arrives as text from postgres-js. */
async function queryCommunityPlayingRows(
  db: PostgresJsDatabase<typeof schema>,
): Promise<CommunityPlayingRow[]> {
  const result = await db.execute<CommunityPlayingRow>(COMMUNITY_PLAYING_QUERY);
  return result as unknown as CommunityPlayingRow[];
}

/** Hydrate game details for the ranked ids, preserving rank order. */
async function hydrateRankedGames(
  db: PostgresJsDatabase<typeof schema>,
  rankedIds: number[],
): Promise<GameDetailDto[]> {
  if (rankedIds.length === 0) return [];
  const games = await db
    .select()
    .from(schema.games)
    .where(and(inArray(schema.games.id, rankedIds), VISIBILITY_FILTER()));
  const gameMap = new Map(games.map((g) => [g.id, g]));
  return rankedIds
    .map((id) => gameMap.get(id))
    .filter((g): g is NonNullable<typeof g> => Boolean(g))
    .map((g) => mapDbRowToDetail(g));
}

/** Build metadata map keyed by stringified gameId for hydrated games only. */
export function buildCommunityPlayingMetadata(
  rows: CommunityPlayingRow[],
  hydratedIds: Iterable<number>,
): MetadataMap {
  const hydrated = new Set(hydratedIds);
  const metadata: MetadataMap = {};
  for (const row of rows) {
    if (!hydrated.has(row.game_id)) continue;
    metadata[String(row.game_id)] = {
      playerCount: row.player_count,
      totalSeconds: Number(row.total_seconds),
    };
  }
  return metadata;
}

/**
 * Fetch the "Your Community Has Been Playing" discover row.
 * Unified source CTE + bespoke cache (shape differs from fetchCategoryRow).
 */
export async function fetchCommunityPlayingRow(
  db: PostgresJsDatabase<typeof schema>,
  redis: Redis,
  cat: DiscoverCategory,
  cacheTtl: number,
): Promise<GameDiscoverRowDto> {
  const cached = await tryCommunityPlayingCache(redis);
  if (cached) {
    return {
      category: cat.category,
      slug: cat.slug,
      games: cached.games,
      metadata: cached.metadata,
    };
  }

  const rows = await queryCommunityPlayingRows(db);
  if (rows.length === 0) {
    return { category: cat.category, slug: cat.slug, games: [], metadata: {} };
  }

  const rankedIds = rows.map((r) => r.game_id);
  const games = await hydrateRankedGames(db, rankedIds);
  const metadata = buildCommunityPlayingMetadata(
    rows,
    games.map((g) => g.id),
  );

  await setCommunityPlayingCache(redis, { games, metadata }, cacheTtl);
  return { category: cat.category, slug: cat.slug, games, metadata };
}
