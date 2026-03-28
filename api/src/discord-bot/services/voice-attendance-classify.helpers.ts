/**
 * Voice attendance classification helpers.
 * Extracted from voice-attendance.service.ts for file size compliance (ROK-719).
 * Population helpers are in voice-attendance-populate.helpers.ts (ROK-985).
 */
import { eq, and, sql, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { classifyVoiceSession } from './voice-attendance.helpers';
import * as flushH from './voice-attendance-flush.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Logger = {
  log: (msg: string) => void;
  warn: (msg: string) => void;
};
type Session = typeof schema.eventVoiceSessions.$inferSelect;

// Re-export autoPopulateAttendance from its new location for callers
export { autoPopulateAttendance } from './voice-attendance-populate.helpers';

/**
 * Load all voice sessions for an event and partition by signup match.
 * Never deletes sessions -- voice presence is ground truth (ROK-985).
 */
export async function loadAndFilterSessions(
  db: Db,
  eventId: number,
  logger?: Logger,
): Promise<{ sessions: Session[]; unmatchedCount: number }> {
  const allSessions = await db
    .select()
    .from(schema.eventVoiceSessions)
    .where(eq(schema.eventVoiceSessions.eventId, eventId));
  const ids = await getSignupIdentifiers(db, eventId);
  const isMatched = (s: Session): boolean =>
    ids.discordIds.has(s.discordUserId) ||
    (s.userId !== null && ids.userIds.has(s.userId));
  const matched = allSessions.filter(isMatched);
  const unmatchedCount = allSessions.length - matched.length;
  if (unmatchedCount > 0 && logger) {
    logger.log(
      `Preserved ${unmatchedCount} voice session(s) for non-signed-up users in event ${eventId}`,
    );
  }
  return { sessions: allSessions, unmatchedCount };
}

/** Get both discordId and userId sets from all signups for an event. */
async function getSignupIdentifiers(
  db: Db,
  eventId: number,
): Promise<{ discordIds: Set<string>; userIds: Set<number> }> {
  const signups = await db
    .select({
      discordUserId: schema.eventSignups.discordUserId,
      userId: schema.eventSignups.userId,
    })
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.eventId, eventId));
  const discordIds = new Set(
    signups.map((s) => s.discordUserId).filter(Boolean) as string[],
  );
  const userIds = new Set(
    signups.map((s) => s.userId).filter((id): id is number => id !== null),
  );
  return { discordIds, userIds };
}

/** Build classifications for sessions. */
export function buildClassifications(
  sessions: Session[],
  eventStart: Date,
  eventEnd: Date,
  eventDurationSec: number,
  graceMs: number,
): Array<{ id: string; classification: string }> {
  return sessions.map((s) => ({
    id: s.id,
    classification: classifyVoiceSession(
      {
        totalDurationSec: s.totalDurationSec,
        firstJoinAt: s.firstJoinAt,
        lastLeaveAt: s.lastLeaveAt,
      },
      eventStart,
      eventEnd,
      eventDurationSec,
      graceMs,
    ),
  }));
}

/** Batch-classify sessions and update DB. */
export async function batchClassifySessions(
  db: Db,
  sessions: Session[],
  eventStart: Date,
  eventEnd: Date,
  eventDurationSec: number,
  graceMs: number,
): Promise<void> {
  const classifications = buildClassifications(
    sessions,
    eventStart,
    eventEnd,
    eventDurationSec,
    graceMs,
  );
  const ids = classifications.map((c) => c.id);
  const caseClauses = classifications
    .map(
      (c) =>
        sql`WHEN ${schema.eventVoiceSessions.id} = ${c.id} THEN ${c.classification}`,
    )
    .reduce((acc, clause) => sql`${acc} ${clause}`);
  await db
    .update(schema.eventVoiceSessions)
    .set({ classification: sql`CASE ${caseClauses} END` })
    .where(sql`${schema.eventVoiceSessions.id} IN (${sql.join(ids, sql`, `)})`);
}

/** Create no_show entries for signed-up users who have no voice session. */
export async function classifyNoShows(
  db: Db,
  eventId: number,
  existingSessions: Session[],
  event: typeof schema.events.$inferSelect,
): Promise<void> {
  const trackedDiscordIds = new Set(
    existingSessions.map((s) => s.discordUserId),
  );
  const trackedUserIds = new Set(
    existingSessions
      .map((s) => s.userId)
      .filter((id): id is number => id !== null),
  );
  const signups = await db
    .select()
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        sql`${schema.eventSignups.status} IN ('signed_up', 'tentative')`,
      ),
    );
  const noShowRows = buildNoShowRows(
    eventId,
    signups,
    trackedDiscordIds,
    trackedUserIds,
    event,
  );
  if (noShowRows.length > 0) {
    await db
      .insert(schema.eventVoiceSessions)
      .values(noShowRows)
      .onConflictDoNothing();
  }
}

function buildNoShowRows(
  eventId: number,
  signups: (typeof schema.eventSignups.$inferSelect)[],
  trackedDiscordIds: Set<string>,
  trackedUserIds: Set<number>,
  event: typeof schema.events.$inferSelect,
) {
  return signups
    .filter((s) => !isTracked(s, trackedDiscordIds, trackedUserIds))
    .filter((s) => !!s.discordUserId) // userId-only signups stay unmarked (no Discord to track)
    .map((s) => buildNoShowRow(s, eventId, event));
}

/** Check if a signup is already tracked by either identifier. */
function isTracked(
  s: typeof schema.eventSignups.$inferSelect,
  discordIds: Set<string>,
  userIds: Set<number>,
): boolean {
  if (s.discordUserId && discordIds.has(s.discordUserId)) return true;
  if (s.userId !== null && userIds.has(s.userId)) return true;
  return false;
}

/** Build a no_show voice session row from a signup. */
function buildNoShowRow(
  s: typeof schema.eventSignups.$inferSelect,
  eventId: number,
  event: typeof schema.events.$inferSelect,
) {
  return {
    eventId,
    userId: s.userId,
    discordUserId: s.discordUserId!,
    discordUsername: s.discordUsername ?? 'Unknown',
    firstJoinAt: event.duration[0],
    lastLeaveAt: event.duration[0],
    totalDurationSec: 0,
    segments: [] as Array<{
      joinAt: string;
      leaveAt: string | null;
      durationSec: number;
    }>,
    classification: 'no_show',
  };
}

/** Compute event duration in whole seconds from the event's time range. */
export function getEventDurationSec(
  event: typeof schema.events.$inferSelect,
): number {
  return Math.floor(
    (event.duration[1].getTime() - event.duration[0].getTime()) / 1000,
  );
}

/** Full classify pipeline for a single event. */
export async function classifyEventSessions(
  db: Db,
  eventId: number,
  eventData: typeof schema.events.$inferSelect | undefined,
  graceMs: number,
  logger: Logger,
): Promise<void> {
  const event = eventData ?? (await flushH.fetchEvent(db, eventId));
  if (!event) return;
  const sec = getEventDurationSec(event);
  if (sec <= 0) return;
  const { sessions } = await loadAndFilterSessions(db, eventId, logger);
  if (sessions.length > 0) {
    await batchClassifySessions(
      db,
      sessions,
      event.duration[0],
      event.duration[1],
      sec,
      graceMs,
    );
  }
  await classifyNoShows(db, eventId, sessions, event);
  logger.log(
    `Classified ${sessions.length} voice session(s) for event ${eventId}`,
  );
}

/**
 * Check if an event should be classified.
 * @param logger - Optional logger; logs the reason when returning false.
 */
export async function shouldClassifyEvent(
  db: Db,
  eventId: number,
  logger?: Logger,
): Promise<boolean> {
  const [unclassified] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.eventVoiceSessions)
    .where(
      and(
        eq(schema.eventVoiceSessions.eventId, eventId),
        isNull(schema.eventVoiceSessions.classification),
      ),
    );
  const [signupCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.eventId, eventId));
  const hasUnclassified = unclassified && unclassified.count > 0;
  const hasSignups = signupCount && signupCount.count > 0;
  if (!hasUnclassified && !hasSignups) {
    logger?.log(
      `Skipping classification for event ${eventId}: no sessions or signups`,
    );
    return false;
  }
  if (!hasUnclassified && hasSignups) {
    const [sessionCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.eventVoiceSessions)
      .where(eq(schema.eventVoiceSessions.eventId, eventId));
    if (sessionCount && sessionCount.count > 0) return true;
  }
  return true;
}
