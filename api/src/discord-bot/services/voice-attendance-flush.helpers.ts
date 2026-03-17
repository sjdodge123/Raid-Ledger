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
      set: {
        userId: session.userId,
        discordUsername: session.discordUsername,
        lastLeaveAt: session.lastLeaveAt,
        totalDurationSec: snapshot.totalDurationSec,
        segments: snapshot.segments,
      },
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
  const vb = bindings.find(
    (b) =>
      b.channelId === channelId &&
      voiceBindingPurposes.includes(b.bindingPurpose),
  );
  if (vb) {
    return resolveBindingEvents(db, vb, channelId, now, logger);
  }
  if (defaultVoiceChannelId && channelId === defaultVoiceChannelId) {
    return resolveDefaultVoiceEvents(db, channelId, now, logger);
  }
  logUnrecognizedChannel(channelId, bindings, voiceBindingPurposes, logger);
  return [];
}

/** Resolve events for a matched voice binding. */
async function resolveBindingEvents(
  db: Db,
  vb: BindingSlim,
  channelId: string,
  now: Date,
  logger: Logger,
): Promise<Array<{ eventId: number; gameId: number | null }>> {
  logger.debug(
    '[voice-pipe] findActive: binding match purpose=%s gameFilter=%s channelId=%s',
    vb.bindingPurpose,
    vb.gameId,
    channelId,
  );
  const gameFilter =
    vb.bindingPurpose === 'game-voice-monitor' && vb.gameId !== null
      ? vb.gameId
      : null;
  const events = await queryActiveEvents(db, gameFilter, now);
  logger.debug(
    '[voice-pipe] findActive: %d active event(s) for channelId=%s',
    events.length,
    channelId,
  );
  return events;
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
