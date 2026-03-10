/**
 * Steam-related query helpers for user profiles (ROK-754).
 * Extracted to keep users-query.helpers.ts under 300 lines.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, desc, sql, and } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type {
  ActivityPeriod,
  GameActivityEntryDto,
  SteamLibraryEntryDto,
} from '@raid-ledger/contract';

/** Shape returned by Discord activity rollup queries. */
export interface DiscordActivityRow {
  gameId: number;
  gameName: string;
  coverUrl: string | null;
  totalSeconds: number;
}

/** Shape returned by Steam playtime queries. */
export interface SteamPlaytimeRow {
  gameId: number;
  gameName: string;
  coverUrl: string | null;
  playtimeForever: number | null;
  playtime2weeks: number | null;
}

/** Intermediate merged activity entry. */
interface MergedEntry {
  gameName: string;
  coverUrl: string | null;
  totalSeconds: number;
}

/** Maximum entries returned in merged activity. */
const ACTIVITY_LIMIT = 20;

/** Convert Steam minutes to seconds. */
function minutesToSeconds(minutes: number | null): number {
  return (minutes ?? 0) * 60;
}

/** Build a map of gameId -> entry from Discord rows. */
function buildDiscordMap(rows: DiscordActivityRow[]): Map<number, MergedEntry> {
  const map = new Map<number, MergedEntry>();
  for (const row of rows) {
    map.set(row.gameId, {
      gameName: row.gameName,
      coverUrl: row.coverUrl,
      totalSeconds: row.totalSeconds,
    });
  }
  return map;
}

/** Merge Steam rows into an existing activity map. */
function mergeSteamIntoMap(
  map: Map<number, MergedEntry>,
  steamRows: SteamPlaytimeRow[],
  period: ActivityPeriod,
): void {
  for (const row of steamRows) {
    const steamSeconds =
      period === 'all'
        ? minutesToSeconds(row.playtimeForever)
        : minutesToSeconds(row.playtime2weeks);
    const existing = map.get(row.gameId);
    if (existing) {
      existing.totalSeconds += steamSeconds;
    } else if (steamSeconds > 0) {
      map.set(row.gameId, {
        gameName: row.gameName,
        coverUrl: row.coverUrl,
        totalSeconds: steamSeconds,
      });
    }
  }
}

/**
 * Merge Discord activity rollup rows with Steam playtime into
 * a unified activity list sorted by total seconds descending.
 */
export function mergeActivityWithSteam(
  discordRows: DiscordActivityRow[],
  steamRows: SteamPlaytimeRow[],
  period: ActivityPeriod,
): GameActivityEntryDto[] {
  const map = buildDiscordMap(discordRows);
  mergeSteamIntoMap(map, steamRows, period);

  return [...map.entries()]
    .sort((a, b) => b[1].totalSeconds - a[1].totalSeconds)
    .slice(0, ACTIVITY_LIMIT)
    .map(([gameId, entry], idx) => ({
      gameId,
      gameName: entry.gameName,
      coverUrl: entry.coverUrl,
      totalSeconds: entry.totalSeconds,
      isMostPlayed: idx === 0,
    }));
}

/** Select columns for Steam playtime queries. */
const STEAM_PLAYTIME_COLUMNS = {
  gameId: schema.gameInterests.gameId,
  gameName: schema.games.name,
  coverUrl: schema.games.coverUrl,
  playtimeForever: schema.gameInterests.playtimeForever,
  playtime2weeks: schema.gameInterests.playtime2weeks,
} as const;

/** Query Steam playtime data for a user from game_interests. */
export async function querySteamPlaytime(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
): Promise<SteamPlaytimeRow[]> {
  return db
    .select(STEAM_PLAYTIME_COLUMNS)
    .from(schema.gameInterests)
    .innerJoin(schema.games, eq(schema.gameInterests.gameId, schema.games.id))
    .where(
      and(
        eq(schema.gameInterests.userId, userId),
        eq(schema.gameInterests.source, 'steam_library'),
      ),
    )
    .orderBy(desc(schema.gameInterests.playtimeForever))
    .limit(1000);
}

/** Steam library select columns. */
const STEAM_LIBRARY_COLUMNS = {
  gameId: schema.gameInterests.gameId,
  gameName: schema.games.name,
  coverUrl: schema.games.coverUrl,
  slug: schema.games.slug,
  playtimeForever: schema.gameInterests.playtimeForever,
  playtime2weeks: schema.gameInterests.playtime2weeks,
} as const;

/** Map raw Steam library rows to DTOs with seconds conversion. */
function mapSteamLibraryRows(
  rows: {
    gameId: number;
    gameName: string;
    coverUrl: string | null;
    slug: string;
    playtimeForever: number | null;
    playtime2weeks: number | null;
  }[],
): SteamLibraryEntryDto[] {
  return rows.map((row) => ({
    gameId: row.gameId,
    gameName: row.gameName,
    coverUrl: row.coverUrl,
    slug: row.slug,
    playtimeSeconds: minutesToSeconds(row.playtimeForever),
    playtime2weeksSeconds:
      row.playtime2weeks !== null ? minutesToSeconds(row.playtime2weeks) : null,
  }));
}

/** Fetch paginated Steam library for a user (ROK-754). */
export async function fetchSteamLibrary(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  page: number,
  limit: number,
): Promise<{ data: SteamLibraryEntryDto[]; total: number }> {
  const offset = (page - 1) * limit;
  const whereClause = and(
    eq(schema.gameInterests.userId, userId),
    eq(schema.gameInterests.source, 'steam_library'),
  );
  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.gameInterests)
    .where(whereClause);
  const rows = await db
    .select(STEAM_LIBRARY_COLUMNS)
    .from(schema.gameInterests)
    .innerJoin(schema.games, eq(schema.gameInterests.gameId, schema.games.id))
    .where(whereClause)
    .orderBy(desc(schema.gameInterests.playtimeForever))
    .limit(limit)
    .offset(offset);
  return { data: mapSteamLibraryRows(rows), total: Number(countResult.count) };
}
