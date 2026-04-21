import { and, isNotNull, gte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import * as tables from '../../drizzle/schema';
import type { Logger } from '@nestjs/common';

interface RollupEntry {
  userId: number;
  gameId: number;
  period: string;
  periodStart: string;
  totalSeconds: number;
}

/**
 * Aggregate closed sessions into day/week/month rollup rows.
 * @param onGamesChanged - ROK-1082: fired once with the unique gameIds touched
 *                        by this rollup so the caller can enqueue one
 *                        taste-vector recompute per game (not per rollup row).
 */
export async function aggregateRollups(
  db: PostgresJsDatabase<typeof schema>,
  logger: Logger,
  onGamesChanged?: (gameIds: number[]) => void,
): Promise<void> {
  const sessions = await fetchClosedSessions(db);
  if (sessions.length === 0) return;

  const rollupMap = buildRollupMap(sessions);
  const upsertCount = await upsertRollups(db, rollupMap);

  logger.log(
    `Rolled up ${sessions.length} session(s) into ${upsertCount} rollup row(s)`,
  );

  if (onGamesChanged) {
    const uniqueGameIds = Array.from(
      new Set(Array.from(rollupMap.values()).map((r) => r.gameId)),
    );
    if (uniqueGameIds.length > 0) onGamesChanged(uniqueGameIds);
  }
}

async function fetchClosedSessions(
  db: PostgresJsDatabase<typeof schema>,
): Promise<
  Array<{
    userId: number;
    gameId: number | null;
    startedAt: Date;
    durationSeconds: number | null;
  }>
> {
  const since = new Date();
  since.setHours(since.getHours() - 48);

  return db
    .select({
      userId: tables.gameActivitySessions.userId,
      gameId: tables.gameActivitySessions.gameId,
      startedAt: tables.gameActivitySessions.startedAt,
      durationSeconds: tables.gameActivitySessions.durationSeconds,
    })
    .from(tables.gameActivitySessions)
    .where(
      and(
        isNotNull(tables.gameActivitySessions.endedAt),
        isNotNull(tables.gameActivitySessions.gameId),
        isNotNull(tables.gameActivitySessions.durationSeconds),
        gte(tables.gameActivitySessions.endedAt, since),
      ),
    );
}

async function upsertRollups(
  db: PostgresJsDatabase<typeof schema>,
  rollupMap: Map<string, RollupEntry>,
): Promise<number> {
  let count = 0;
  for (const rollup of rollupMap.values()) {
    await db
      .insert(tables.gameActivityRollups)
      .values({
        userId: rollup.userId,
        gameId: rollup.gameId,
        period: rollup.period,
        periodStart: rollup.periodStart,
        totalSeconds: rollup.totalSeconds,
      })
      .onConflictDoUpdate({
        target: [
          tables.gameActivityRollups.userId,
          tables.gameActivityRollups.gameId,
          tables.gameActivityRollups.period,
          tables.gameActivityRollups.periodStart,
        ],
        set: { totalSeconds: sql`EXCLUDED.total_seconds` },
      });
    count++;
  }
  return count;
}

/** Build the rollup aggregation map from closed sessions. */
function buildRollupMap(
  sessions: Array<{
    userId: number;
    gameId: number | null;
    startedAt: Date;
    durationSeconds: number | null;
  }>,
): Map<string, RollupEntry> {
  const map = new Map<string, RollupEntry>();

  for (const s of sessions) {
    if (!s.gameId || !s.durationSeconds) continue;
    const d = s.startedAt;

    addToMap(map, s.userId, s.gameId, 'day', formatDate(d), s.durationSeconds);
    addToMap(
      map,
      s.userId,
      s.gameId,
      'week',
      getWeekStart(d),
      s.durationSeconds,
    );
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    addToMap(map, s.userId, s.gameId, 'month', month, s.durationSeconds);
  }

  return map;
}

function addToMap(
  map: Map<string, RollupEntry>,
  userId: number,
  gameId: number,
  period: string,
  periodStart: string,
  dur: number,
): void {
  const key = `${userId}:${gameId}:${period}:${periodStart}`;
  const existing = map.get(key);
  if (existing) {
    existing.totalSeconds += dur;
  } else {
    map.set(key, { userId, gameId, period, periodStart, totalSeconds: dur });
  }
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return formatDate(d);
}
