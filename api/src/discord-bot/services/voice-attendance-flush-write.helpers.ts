/**
 * Voice session flush WRITES (ROK-2174).
 *
 * The 30 s flush used to issue one upsert per open session (2,396 statements
 * a day in prod, each paying a ~240 ms commit). It now writes each tick as ONE
 * multi-row upsert into `event_voice_sessions`, chunked, with the old per-row
 * path kept as the fallback so one bad row can never lose the rest.
 *
 * Moved out of voice-attendance-flush.helpers.ts (which re-exports
 * `flushSingleSession` / `flushDirtySessions`) for the 300-line cap.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  type InMemorySession,
  snapshotSessionForFlush,
} from './voice-attendance.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Logger = {
  error: (msg: string, ...args: unknown[]) => void;
  debug: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
};
type Snapshot = ReturnType<typeof snapshotSessionForFlush>;

/**
 * Rows per upsert statement. Each row binds 8 parameters, so 1,000 rows is
 * 8,000 — far under Postgres's 65,535 bind-parameter ceiling (which 8,191 rows
 * would hit) while a real tick carries a few dozen sessions at most.
 */
export const FLUSH_UPSERT_CHUNK = 1000;

const T = schema.eventVoiceSessions;

/** The insert row the flush has always written for one session. */
function toInsertRow(session: InMemorySession, snapshot: Snapshot) {
  return {
    eventId: session.eventId,
    userId: session.userId,
    discordUserId: session.discordUserId,
    discordUsername: session.discordUsername,
    firstJoinAt: session.firstJoinAt,
    lastLeaveAt: session.lastLeaveAt,
    totalDurationSec: snapshot.totalDurationSec,
    segments: snapshot.segments,
  };
}

/** Conflict update for the single-row path (values bound per session). */
function buildUpsertSet(session: InMemorySession, snapshot: Snapshot) {
  return {
    userId: session.userId,
    discordUsername: session.discordUsername,
    lastLeaveAt: session.lastLeaveAt,
    totalDurationSec: snapshot.totalDurationSec,
    segments: snapshot.segments,
  };
}

/**
 * Conflict update for the batch path: the SAME five columns, each taken from
 * that row's proposed insert values (`excluded.*`). `first_join_at` and
 * `classification` are left alone exactly as the single-row set leaves them.
 */
const BATCH_UPSERT_SET = {
  userId: sql`excluded.user_id`,
  discordUsername: sql`excluded.discord_username`,
  lastLeaveAt: sql`excluded.last_leave_at`,
  totalDurationSec: sql`excluded.total_duration_sec`,
  segments: sql`excluded.segments`,
};

/** Upsert a single voice session row (the fallback path). */
async function upsertSessionRow(
  db: Db,
  session: InMemorySession,
  snapshot: Snapshot,
): Promise<void> {
  await db
    .insert(T)
    .values(toInsertRow(session, snapshot))
    .onConflictDoUpdate({
      target: [T.eventId, T.discordUserId],
      set: buildUpsertSet(session, snapshot),
    });
}

/** Flush a single in-memory session to the database. */
export async function flushSingleSession(
  db: Db,
  session: InMemorySession,
  logger: Logger,
): Promise<void> {
  try {
    const snapshot = snapshotSessionForFlush(session);
    await upsertSessionRow(db, session, snapshot);
    session.dirty = false;
  } catch (err) {
    logger.error(
      `Failed to flush session ${session.eventId}:${session.discordUserId}: ${err}`,
    );
  }
}

/**
 * Write one chunk as a single multi-row upsert. Sessions come from a Map keyed
 * `${eventId}:${discordUserId}`, so no chunk can carry the same conflict key
 * twice. On failure, retry the chunk row by row (each row isolated, as before).
 */
async function flushChunk(
  db: Db,
  chunk: InMemorySession[],
  logger: Logger,
): Promise<void> {
  try {
    const rows = chunk.map((s) => toInsertRow(s, snapshotSessionForFlush(s)));
    await db
      .insert(T)
      .values(rows)
      .onConflictDoUpdate({
        target: [T.eventId, T.discordUserId],
        set: BATCH_UPSERT_SET,
      });
    for (const s of chunk) s.dirty = false;
  } catch (err) {
    logger.warn(
      `Batched voice flush of ${chunk.length} session(s) failed, retrying per row: ${err}`,
    );
    for (const s of chunk) await flushSingleSession(db, s, logger);
  }
}

/**
 * Fixed row order for every flush: (eventId, discordUserId). Two overlapping
 * flushes then take their row locks in the same order and cannot deadlock,
 * even when a key was deleted and re-added (moving it in Map order) between them.
 */
function compareFlushOrder(a: InMemorySession, b: InMemorySession): number {
  if (a.eventId !== b.eventId) return a.eventId - b.eventId;
  if (a.discordUserId === b.discordUserId) return 0;
  return a.discordUserId < b.discordUserId ? -1 : 1;
}

/** Flush all dirty/active sessions to the DB — one statement per chunk. */
export async function flushDirtySessions(
  db: Db,
  sessions: Map<string, InMemorySession>,
  logger: Logger,
): Promise<void> {
  const dirty = [...sessions.values()].filter((s) => s.dirty || s.isActive);
  if (dirty.length === 0) return;
  dirty.sort(compareFlushOrder);
  for (let i = 0; i < dirty.length; i += FLUSH_UPSERT_CHUNK) {
    await flushChunk(db, dirty.slice(i, i + FLUSH_UPSERT_CHUNK), logger);
  }
  logger.debug(`Flushed ${dirty.length} voice session(s) to DB`);
}
