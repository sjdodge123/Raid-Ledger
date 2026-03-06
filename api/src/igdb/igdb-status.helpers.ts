import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type {
  IgdbSyncStatusDto,
  IgdbHealthStatusDto,
  GameActivityResponseDto,
  ActivityPeriod,
} from '@raid-ledger/contract';
import {
  queryTopPlayers,
  queryTotalSeconds,
  buildActivityConditions,
} from './igdb-activity.helpers';

/** Token state for health status reporting. */
export interface TokenState {
  accessToken: string | null;
  tokenExpiry: Date | null;
  lastApiCallAt: Date | null;
  lastApiCallSuccess: boolean | null;
}

/**
 * Query sync status from database.
 * @param db - Database connection
 * @param syncInProgress - Whether a sync is currently running
 * @returns Sync status DTO
 */
export async function querySyncStatus(
  db: PostgresJsDatabase<typeof schema>,
  syncInProgress: boolean,
): Promise<IgdbSyncStatusDto> {
  const r = await db
    .select({
      count: sql<number>`count(*)::int`,
      lastSync: sql<string | null>`max(${schema.games.cachedAt})::text`,
    })
    .from(schema.games);
  return {
    lastSyncAt: r[0]?.lastSync ?? null,
    gameCount: r[0]?.count ?? 0,
    syncInProgress,
  };
}

/**
 * Build health status from token state.
 * @param state - Current token and API call state
 * @returns Health status DTO
 */
export function buildHealthStatus(state: TokenState): IgdbHealthStatusDto {
  const hasToken = state.accessToken && state.tokenExpiry;
  const tokenStatus = hasToken
    ? new Date() < state.tokenExpiry!
      ? 'valid'
      : 'expired'
    : 'not_fetched';
  return {
    tokenStatus,
    tokenExpiresAt: state.tokenExpiry?.toISOString() ?? null,
    lastApiCallAt: state.lastApiCallAt?.toISOString() ?? null,
    lastApiCallSuccess: state.lastApiCallSuccess,
  };
}

/**
 * Query game activity with privacy filtering.
 * @param db - Database connection
 * @param gameId - Game ID
 * @param period - Activity period
 * @returns Activity response DTO
 */
export async function queryGameActivity(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
  period: ActivityPeriod,
): Promise<GameActivityResponseDto> {
  const conditions = buildActivityConditions(gameId, period);
  const [topPlayers, totalSeconds] = await Promise.all([
    queryTopPlayers(db, conditions),
    queryTotalSeconds(db, conditions),
  ]);
  return {
    topPlayers: topPlayers.map((p) => ({ ...p })),
    totalSeconds,
    period,
  };
}
