/**
 * Voice session flush & DB query helpers.
 * Extracted from voice-attendance.service.ts for file size compliance (ROK-719).
 */
import { eq, and, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  toVoiceSessionDto,
  buildAttendanceSummary,
} from './voice-attendance.helpers';
import { findActiveEventsByEphemeralChannel } from './voice-attendance-ephemeral.helpers';
import { unionSeriesEvents } from './voice-attendance-series.helpers';

// ROK-2174: the flush writes (now one batched upsert per tick) live in
// voice-attendance-flush-write.helpers.ts; re-exported so callers are unchanged.
export {
  flushSingleSession,
  flushDirtySessions,
} from './voice-attendance-flush-write.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Logger = {
  error: (msg: string, ...args: unknown[]) => void;
  debug: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
};

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

/** Channel binding purposes that map to voice-monitored channels. */
export const VOICE_BINDING_PURPOSES: readonly string[] = [
  'game-voice-monitor',
  'general-lobby',
];

/** Minimal binding shape for findActiveEventsForChannel. */
interface BindingSlim {
  channelId: string;
  bindingPurpose: string;
  gameId: number | null;
  // ROK-1389: series voice bindings carry a recurrence group so a live instance
  // whose gameId differs from the binding's stored gameId still maps back.
  recurrenceGroupId?: string | null;
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
  // ROK-1352: ephemeral channels are neither a binding nor the default — match
  // by events.ephemeral_voice_channel_id before the unrecognized fallthrough.
  const ephemeral = await findActiveEventsByEphemeralChannel(
    db,
    channelId,
    now,
  );
  if (ephemeral.length > 0) return ephemeral;
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
    `[voice-pipe] findActive: ${matched.length} binding(s) channelId=${channelId} gameIds=${gameIds ? gameIds.join(',') : 'all'}`,
  );
  const events = gameIds
    ? await queryActiveEventsMultiGame(db, gameIds, now)
    : await queryActiveEvents(db, null, now);
  // ROK-1389: union instances matched by the bindings' recurrence group(s) so a
  // series voice channel maps to this week's instance even when its gameId
  // differs from (or is null vs) the binding's stored gameId. Deduped by id.
  const merged = await unionSeriesEvents(db, matched, events, now);
  logger.debug(
    `[voice-pipe] findActive: ${merged.length} active event(s) for channelId=${channelId}`,
  );
  return merged;
}

/**
 * Extract unique gameIds from bindings; null means "all games". A general-lobby
 * binding or a null-game monitor makes the WHOLE channel all-games on purpose
 * (ROK-842; operator ruling on TDB:223): adding a game monitor to a lobby
 * channel must not quietly narrow attendance for every other game.
 */
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
    `[voice-pipe] findActive: default voice match channelId=${channelId}`,
  );
  const events = await queryActiveEvents(db, null, now);
  logger.debug(
    `[voice-pipe] findActive: ${events.length} active event(s) for channelId=${channelId}`,
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
  // NestJS Logger does not printf-substitute %s/%d — interpolate directly so the
  // channel id + counts land on one line instead of four orphan WARN lines.
  logger.warn(
    `[voice-pipe] findActive: unrecognized channel=${channelId}, bindings=${bindings.length}, voiceBindings=${voiceBindingCount}`,
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
