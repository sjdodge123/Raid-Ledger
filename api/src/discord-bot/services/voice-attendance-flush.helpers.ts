/**
 * Voice session flush & DB query helpers.
 * Extracted from voice-attendance.service.ts for file size compliance (ROK-719).
 */
import { eq, and, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  type InMemorySession,
  snapshotSessionForFlush,
  toVoiceSessionDto,
  buildAttendanceSummary,
} from './voice-attendance.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Logger = {
  error: (msg: string, ...args: unknown[]) => void;
  debug: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
};

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

/** Build the conflict-update column set for voice session upserts. */
function buildUpsertSet(
  session: InMemorySession,
  snapshot: ReturnType<typeof snapshotSessionForFlush>,
) {
  return {
    userId: session.userId,
    discordUsername: session.discordUsername,
    lastLeaveAt: session.lastLeaveAt,
    totalDurationSec: snapshot.totalDurationSec,
    segments: snapshot.segments,
  };
}

/** Upsert a voice session row into the database. */
async function upsertSessionRow(
  db: Db,
  session: InMemorySession,
  snapshot: ReturnType<typeof snapshotSessionForFlush>,
): Promise<void> {
  await db
    .insert(schema.eventVoiceSessions)
    .values({
      eventId: session.eventId,
      userId: session.userId,
      discordUserId: session.discordUserId,
      discordUsername: session.discordUsername,
      firstJoinAt: session.firstJoinAt,
      lastLeaveAt: session.lastLeaveAt,
      totalDurationSec: snapshot.totalDurationSec,
      segments: snapshot.segments,
    })
    .onConflictDoUpdate({
      target: [
        schema.eventVoiceSessions.eventId,
        schema.eventVoiceSessions.discordUserId,
      ],
      set: buildUpsertSet(session, snapshot),
    });
}

/** Query active scheduled events, optionally filtered by gameId. */
export async function queryActiveEvents(
  db: Db,
  gameId: number | null,
  now: Date,
): Promise<Array<{ eventId: number; gameId: number | null }>> {
  const conditions = [
    eq(schema.events.isAdHoc, false),
    sql`${schema.events.cancelledAt} IS NULL`,
    sql`lower(${schema.events.duration}) <= ${now.toISOString()}::timestamptz`,
    sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) >= ${now.toISOString()}::timestamptz`,
  ];
  if (gameId !== null) conditions.push(eq(schema.events.gameId, gameId));
  const activeEvents = await db
    .select({ id: schema.events.id, gameId: schema.events.gameId })
    .from(schema.events)
    .where(and(...conditions));
  return activeEvents.map((e) => ({ eventId: e.id, gameId: e.gameId }));
}

/** Query active events matching ANY of the given gameIds. */
export async function queryActiveEventsMultiGame(
  db: Db,
  gameIds: number[],
  now: Date,
): Promise<Array<{ eventId: number; gameId: number | null }>> {
  const conditions = [
    eq(schema.events.isAdHoc, false),
    sql`${schema.events.cancelledAt} IS NULL`,
    sql`lower(${schema.events.duration}) <= ${now.toISOString()}::timestamptz`,
    sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) >= ${now.toISOString()}::timestamptz`,
    sql`${schema.events.gameId} IN (${sql.join(
      gameIds.map((id) => sql`${id}`),
      sql`, `,
    )})`,
  ];
  const rows = await db
    .select({ id: schema.events.id, gameId: schema.events.gameId })
    .from(schema.events)
    .where(and(...conditions));
  return rows.map((e) => ({ eventId: e.id, gameId: e.gameId }));
}

/** Flush all dirty/active sessions to the DB. */
export async function flushDirtySessions(
  db: Db,
  sessions: Map<string, InMemorySession>,
  logger: Logger,
): Promise<void> {
  const dirty = [...sessions.values()].filter((s) => s.dirty || s.isActive);
  if (dirty.length === 0) return;
  for (const s of dirty) await flushSingleSession(db, s, logger);
  logger.debug(`Flushed ${dirty.length} voice session(s) to DB`);
}

/** Fetch ended events within lookback window. */
export async function fetchEndedEvents(
  db: Db,
  now: Date,
  lookbackMs: number,
): Promise<(typeof schema.events.$inferSelect)[]> {
  const lookbackStart = new Date(now.getTime() - lookbackMs);
  return db
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.isAdHoc, false),
        sql`${schema.events.cancelledAt} IS NULL`,
        sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) >= ${lookbackStart.toISOString()}::timestamptz`,
        sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) <= ${now.toISOString()}::timestamptz`,
      ),
    );
}

/** Fetch a single event by ID. */
export async function fetchEvent(
  db: Db,
  eventId: number,
): Promise<typeof schema.events.$inferSelect | undefined> {
  const [event] = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return event;
}

/** Fetch voice sessions for an event. */
export async function fetchVoiceSessions(
  db: Db,
  eventId: number,
): Promise<(typeof schema.eventVoiceSessions.$inferSelect)[]> {
  return db
    .select()
    .from(schema.eventVoiceSessions)
    .where(eq(schema.eventVoiceSessions.eventId, eventId));
}

/** Minimal binding shape for findActiveEventsForChannel. */
interface BindingSlim {
  channelId: string;
  bindingPurpose: string;
  gameId: number | null;
}

/** Resolve active events for a voice channel with diagnostic logging. */
export async function findActiveEventsForChannel(
  db: Db,
  channelId: string,
  bindings: BindingSlim[],
  voiceBindingPurposes: readonly string[],
  defaultVoiceChannelId: string | null,
  logger: Logger,
): Promise<Array<{ eventId: number; gameId: number | null }>> {
  const now = new Date();
  const matched = bindings.filter(
    (b) =>
      b.channelId === channelId &&
      voiceBindingPurposes.includes(b.bindingPurpose),
  );
  if (matched.length > 0) {
    return resolveMultiBindingEvents(db, matched, channelId, now, logger);
  }
  if (defaultVoiceChannelId && channelId === defaultVoiceChannelId) {
    return resolveDefaultVoiceEvents(db, channelId, now, logger);
  }
  logUnrecognizedChannel(channelId, bindings, voiceBindingPurposes, logger);
  return [];
}

/** Resolve events for ALL matched voice bindings (multi-game channels). */
async function resolveMultiBindingEvents(
  db: Db,
  matched: BindingSlim[],
  channelId: string,
  now: Date,
  logger: Logger,
): Promise<Array<{ eventId: number; gameId: number | null }>> {
  const gameIds = extractGameIds(matched);
  logger.debug(
    '[voice-pipe] findActive: %d binding(s) channelId=%s gameIds=%s',
    matched.length,
    channelId,
    gameIds ? gameIds.join(',') : 'all',
  );
  const events = gameIds
    ? await queryActiveEventsMultiGame(db, gameIds, now)
    : await queryActiveEvents(db, null, now);
  logger.debug(
    '[voice-pipe] findActive: %d active event(s) for channelId=%s',
    events.length,
    channelId,
  );
  return events;
}

/** Extract unique gameIds from bindings; null means "all games". */
function extractGameIds(bindings: BindingSlim[]): number[] | null {
  const ids = new Set<number>();
  for (const b of bindings) {
    if (b.bindingPurpose !== 'game-voice-monitor' || b.gameId === null)
      return null;
    ids.add(b.gameId);
  }
  return [...ids];
}

/** Resolve events for the default voice channel. */
async function resolveDefaultVoiceEvents(
  db: Db,
  channelId: string,
  now: Date,
  logger: Logger,
): Promise<Array<{ eventId: number; gameId: number | null }>> {
  logger.debug(
    '[voice-pipe] findActive: default voice match channelId=%s',
    channelId,
  );
  const events = await queryActiveEvents(db, null, now);
  logger.debug(
    '[voice-pipe] findActive: %d active event(s) for channelId=%s',
    events.length,
    channelId,
  );
  return events;
}

/** Log a warning when a channel is not recognized. */
function logUnrecognizedChannel(
  channelId: string,
  bindings: BindingSlim[],
  voiceBindingPurposes: readonly string[],
  logger: Logger,
): void {
  const voiceBindingCount = bindings.filter((b) =>
    voiceBindingPurposes.includes(b.bindingPurpose),
  ).length;
  logger.warn(
    '[voice-pipe] findActive: unrecognized channel=%s, bindings=%d, voiceBindings=%d',
    channelId,
    bindings.length,
    voiceBindingCount,
  );
}

/** Build a VoiceSessionsResponseDto from DB rows. */
export async function buildVoiceSessionsResponse(
  db: Db,
  eventId: number,
): Promise<{
  eventId: number;
  sessions: ReturnType<typeof toVoiceSessionDto>[];
}> {
  const rows = await fetchVoiceSessions(db, eventId);
  return { eventId, sessions: rows.map((s) => toVoiceSessionDto(s)) };
}

/** Fetch sessions and build an attendance summary. */
export async function buildAttendanceSummaryFromDb(
  db: Db,
  eventId: number,
): Promise<ReturnType<typeof buildAttendanceSummary>> {
  return buildAttendanceSummary(eventId, await fetchVoiceSessions(db, eventId));
}
