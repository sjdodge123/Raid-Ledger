import { eq, and, isNull, lt, sql, gte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import * as tables from '../../drizzle/schema';
import type { Logger } from '@nestjs/common';

/** Maximum session duration in seconds (24 hours) */
export const MAX_SESSION_DURATION_SECONDS = 24 * 60 * 60;

/** How often to flush the in-memory buffer to the database (ms) */
export const FLUSH_INTERVAL_MS = 30_000;

/** Source of a game activity detection */
export type ActivitySource = 'presence' | 'voice';

export {
  AUTO_HEART_THRESHOLD_SECONDS,
  autoHeartCheck,
} from './game-activity-heart.helpers';
export { aggregateRollups } from './game-activity-rollup.helpers';

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
    await insertOpenSession(db, ev, cache, logger);
  }
}

async function hasOpenSession(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  activityName: string,
): Promise<boolean> {
  const [existing] = await db
    .select({ id: tables.gameActivitySessions.id })
    .from(tables.gameActivitySessions)
    .where(
      and(
        eq(tables.gameActivitySessions.userId, userId),
        eq(tables.gameActivitySessions.discordActivityName, activityName),
        isNull(tables.gameActivitySessions.endedAt),
      ),
    )
    .limit(1);
  return !!existing;
}

async function insertOpenSession(
  db: PostgresJsDatabase<typeof schema>,
  ev: SessionOpenEvent,
  cache: Map<string, number | null>,
  logger: Logger,
): Promise<void> {
  const resolvedGameId = cache.get(ev.discordActivityName);
  const gameId = resolvedGameId !== undefined ? resolvedGameId : null;

  try {
    if (await hasOpenSession(db, ev.userId, ev.discordActivityName)) return;

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

/**
 * Process close events: find open sessions and set endedAt + duration.
 */
export async function processCloseEvents(
  db: PostgresJsDatabase<typeof schema>,
  closes: SessionCloseEvent[],
  logger: Logger,
): Promise<void> {
  for (const ev of closes) {
    await closeOpenSession(db, ev, logger);
  }
}

async function findOpenSessionForClose(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  activityName: string,
): Promise<{ id: string; startedAt: Date } | null> {
  const [session] = await db
    .select({
      id: tables.gameActivitySessions.id,
      startedAt: tables.gameActivitySessions.startedAt,
    })
    .from(tables.gameActivitySessions)
    .where(
      and(
        eq(tables.gameActivitySessions.userId, userId),
        eq(tables.gameActivitySessions.discordActivityName, activityName),
        isNull(tables.gameActivitySessions.endedAt),
      ),
    )
    .orderBy(tables.gameActivitySessions.startedAt)
    .limit(1);
  return session ?? null;
}

async function closeOpenSession(
  db: PostgresJsDatabase<typeof schema>,
  ev: SessionCloseEvent,
  logger: Logger,
): Promise<void> {
  try {
    const session = await findOpenSessionForClose(
      db,
      ev.userId,
      ev.discordActivityName,
    );
    if (!session) return;

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

/**
 * Close orphaned sessions left open from a prior restart.
 */
export async function closeOrphanedSessions(
  db: PostgresJsDatabase<typeof schema>,
  logger: Logger,
): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - MAX_SESSION_DURATION_SECONDS * 1000);

  const staleCount = await closeStaleSessions(db, now, cutoff);
  const recentCount = await closeRecentSessions(db, now, cutoff);

  const total = staleCount + recentCount;
  if (total > 0) {
    logger.log(
      `Closed ${total} orphaned session(s) (${staleCount} stale, ${recentCount} recent)`,
    );
  }
}

async function closeStaleSessions(
  db: PostgresJsDatabase<typeof schema>,
  now: Date,
  cutoff: Date,
): Promise<number> {
  const result = await db
    .update(tables.gameActivitySessions)
    .set({ endedAt: now, durationSeconds: MAX_SESSION_DURATION_SECONDS })
    .where(
      and(
        isNull(tables.gameActivitySessions.endedAt),
        lt(tables.gameActivitySessions.startedAt, cutoff),
      ),
    )
    .returning({ id: tables.gameActivitySessions.id });
  return result.length;
}

async function closeRecentSessions(
  db: PostgresJsDatabase<typeof schema>,
  now: Date,
  cutoff: Date,
): Promise<number> {
  const result = await db
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
  return result.length;
}
