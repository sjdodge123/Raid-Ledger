import {
  eq,
  and,
  isNull,
  lt,
  sql,
  isNotNull,
  gte,
  sum,
  inArray,
} from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import * as tables from '../../drizzle/schema';
import type { Logger } from '@nestjs/common';

/** Maximum session duration in seconds (24 hours) */
export const MAX_SESSION_DURATION_SECONDS = 24 * 60 * 60;

/** How often to flush the in-memory buffer to the database (ms) */
export const FLUSH_INTERVAL_MS = 30_000;

/** Minimum cumulative playtime (seconds) to trigger auto-heart */
export const AUTO_HEART_THRESHOLD_SECONDS = 18_000; // 5 hours

/** Source of a game activity detection */
export type ActivitySource = 'presence' | 'voice';

export interface SessionOpenEvent {
  type: 'open';
  userId: number;
  gameId: number | null;
  discordActivityName: string;
  startedAt: Date;
}

export interface SessionCloseEvent {
  type: 'close';
  userId: number;
  discordActivityName: string;
  endedAt: Date;
}

export type BufferedEvent = SessionOpenEvent | SessionCloseEvent;

/**
 * Resolve Discord activity names to game IDs via mappings table + exact match.
 */
export async function resolveGameNames(
  db: PostgresJsDatabase<typeof schema>,
  names: string[],
  cache: Map<string, number | null>,
): Promise<void> {
  for (const name of names) {
    const [mapping] = await db
      .select({ gameId: tables.discordGameMappings.gameId })
      .from(tables.discordGameMappings)
      .where(eq(tables.discordGameMappings.discordActivityName, name))
      .limit(1);

    if (mapping) {
      cache.set(name, mapping.gameId);
      continue;
    }

    const [game] = await db
      .select({ id: tables.games.id })
      .from(tables.games)
      .where(eq(tables.games.name, name))
      .limit(1);

    cache.set(name, game?.id ?? null);
  }
}

/**
 * Process open events: insert new game activity sessions.
 */
export async function processOpenEvents(
  db: PostgresJsDatabase<typeof schema>,
  opens: SessionOpenEvent[],
  cache: Map<string, number | null>,
  logger: Logger,
): Promise<void> {
  for (const ev of opens) {
    const resolvedGameId = cache.get(ev.discordActivityName);
    const gameId = resolvedGameId !== undefined ? resolvedGameId : null;

    try {
      const [existingOpen] = await db
        .select({ id: tables.gameActivitySessions.id })
        .from(tables.gameActivitySessions)
        .where(
          and(
            eq(tables.gameActivitySessions.userId, ev.userId),
            eq(tables.gameActivitySessions.discordActivityName, ev.discordActivityName),
            isNull(tables.gameActivitySessions.endedAt),
          ),
        )
        .limit(1);

      if (existingOpen) continue;

      await db.insert(tables.gameActivitySessions).values({
        userId: ev.userId,
        gameId,
        discordActivityName: ev.discordActivityName,
        startedAt: ev.startedAt,
      });
    } catch (err) {
      logger.warn(
        `Failed to insert session for user ${ev.userId} / "${ev.discordActivityName}": ${err}`,
      );
    }
  }
}

/**
 * Process close events: find open sessions and set endedAt + duration.
 */
export async function processCloseEvents(
  db: PostgresJsDatabase<typeof schema>,
  closes: SessionCloseEvent[],
  logger: Logger,
): Promise<void> {
  for (const ev of closes) {
    try {
      const [session] = await db
        .select({
          id: tables.gameActivitySessions.id,
          startedAt: tables.gameActivitySessions.startedAt,
        })
        .from(tables.gameActivitySessions)
        .where(
          and(
            eq(tables.gameActivitySessions.userId, ev.userId),
            eq(tables.gameActivitySessions.discordActivityName, ev.discordActivityName),
            isNull(tables.gameActivitySessions.endedAt),
          ),
        )
        .orderBy(tables.gameActivitySessions.startedAt)
        .limit(1);

      if (!session) continue;

      const durationSeconds = Math.min(
        Math.max(
          0,
          Math.floor((ev.endedAt.getTime() - session.startedAt.getTime()) / 1000),
        ),
        MAX_SESSION_DURATION_SECONDS,
      );

      await db
        .update(tables.gameActivitySessions)
        .set({ endedAt: ev.endedAt, durationSeconds })
        .where(eq(tables.gameActivitySessions.id, session.id));
    } catch (err) {
      logger.warn(
        `Failed to close session for user ${ev.userId} / "${ev.discordActivityName}": ${err}`,
      );
    }
  }
}

/**
 * Close orphaned sessions left open from a prior restart.
 */
export async function closeOrphanedSessions(
  db: PostgresJsDatabase<typeof schema>,
  logger: Logger,
): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - MAX_SESSION_DURATION_SECONDS * 1000);

  const staleResult = await db
    .update(tables.gameActivitySessions)
    .set({ endedAt: now, durationSeconds: MAX_SESSION_DURATION_SECONDS })
    .where(
      and(
        isNull(tables.gameActivitySessions.endedAt),
        lt(tables.gameActivitySessions.startedAt, cutoff),
      ),
    )
    .returning({ id: tables.gameActivitySessions.id });

  const recentResult = await db
    .update(tables.gameActivitySessions)
    .set({
      endedAt: now,
      durationSeconds: sql`EXTRACT(EPOCH FROM ${now.toISOString()}::timestamp - ${tables.gameActivitySessions.startedAt})::integer`,
    })
    .where(
      and(
        isNull(tables.gameActivitySessions.endedAt),
        gte(tables.gameActivitySessions.startedAt, cutoff),
      ),
    )
    .returning({ id: tables.gameActivitySessions.id });

  const total = staleResult.length + recentResult.length;
  if (total > 0) {
    logger.log(
      `Closed ${total} orphaned session(s) (${staleResult.length} stale, ${recentResult.length} recent)`,
    );
  }
}

/**
 * Aggregate closed sessions into day/week/month rollup rows.
 */
export async function aggregateRollups(
  db: PostgresJsDatabase<typeof schema>,
  logger: Logger,
): Promise<void> {
  const since = new Date();
  since.setHours(since.getHours() - 48);

  const sessions = await db
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

  if (sessions.length === 0) return;

  const rollupMap = buildRollupMap(sessions);
  let upsertCount = 0;

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
    upsertCount++;
  }

  logger.log(
    `Rolled up ${sessions.length} session(s) into ${upsertCount} rollup row(s)`,
  );
}

interface RollupEntry {
  userId: number;
  gameId: number;
  period: string;
  periodStart: string;
  totalSeconds: number;
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
    addToMap(map, s.userId, s.gameId, 'week', getWeekStart(d), s.durationSeconds);
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

/**
 * Auto-heart games where a user's cumulative playtime exceeds threshold.
 */
export async function autoHeartCheck(
  db: PostgresJsDatabase<typeof schema>,
  logger: Logger,
): Promise<void> {
  const candidates = await findHeartCandidates(db);
  if (candidates.length === 0) return;

  const candidateUserIds = [...new Set(candidates.map((c) => c.userId))];
  const toInsert = await filterCandidates(db, candidates, candidateUserIds);

  if (toInsert.length === 0) return;

  await db
    .insert(tables.gameInterests)
    .values(
      toInsert.map((row) => ({
        userId: row.userId,
        gameId: row.gameId!,
        source: 'discord',
      })),
    )
    .onConflictDoNothing();

  logger.log(`Auto-hearted ${toInsert.length} game(s) for users`);
}

async function findHeartCandidates(
  db: PostgresJsDatabase<typeof schema>,
): Promise<Array<{ userId: number; gameId: number | null }>> {
  return db
    .select({
      userId: tables.gameActivitySessions.userId,
      gameId: tables.gameActivitySessions.gameId,
    })
    .from(tables.gameActivitySessions)
    .where(
      and(
        isNotNull(tables.gameActivitySessions.gameId),
        isNotNull(tables.gameActivitySessions.endedAt),
      ),
    )
    .groupBy(
      tables.gameActivitySessions.userId,
      tables.gameActivitySessions.gameId,
    )
    .having(
      gte(
        sum(tables.gameActivitySessions.durationSeconds),
        String(AUTO_HEART_THRESHOLD_SECONDS),
      ),
    );
}

async function filterCandidates(
  db: PostgresJsDatabase<typeof schema>,
  candidates: Array<{ userId: number; gameId: number | null }>,
  userIds: number[],
): Promise<Array<{ userId: number; gameId: number | null }>> {
  const optedOut = await db
    .select({ userId: tables.userPreferences.userId })
    .from(tables.userPreferences)
    .where(
      and(
        eq(tables.userPreferences.key, 'autoHeartGames'),
        sql`${tables.userPreferences.value}::text = 'false'`,
      ),
    );
  const optedOutSet = new Set(optedOut.map((r) => r.userId));

  const existing = await db
    .select({
      userId: tables.gameInterests.userId,
      gameId: tables.gameInterests.gameId,
    })
    .from(tables.gameInterests)
    .where(inArray(tables.gameInterests.userId, userIds));
  const existingSet = new Set(existing.map((r) => `${r.userId}:${r.gameId}`));

  const suppressions = await db
    .select({
      userId: tables.gameInterestSuppressions.userId,
      gameId: tables.gameInterestSuppressions.gameId,
    })
    .from(tables.gameInterestSuppressions)
    .where(inArray(tables.gameInterestSuppressions.userId, userIds));
  const suppressedSet = new Set(
    suppressions.map((r) => `${r.userId}:${r.gameId}`),
  );

  return candidates.filter((c) => {
    if (!c.gameId) return false;
    if (optedOutSet.has(c.userId)) return false;
    const key = `${c.userId}:${c.gameId}`;
    return !existingSet.has(key) && !suppressedSet.has(key);
  });
}
