/**
 * Voice attendance classification helpers.
 * Extracted from voice-attendance.service.ts for file size compliance (ROK-719).
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

/** Load sessions, filter by signups, and delete orphans. */
export async function loadAndFilterSessions(
  db: Db,
  eventId: number,
): Promise<{ sessions: Session[]; orphanCount: number }> {
  const allSessions = await db
    .select()
    .from(schema.eventVoiceSessions)
    .where(eq(schema.eventVoiceSessions.eventId, eventId));
  const signedUpIds = await getSignedUpDiscordIds(db, eventId);
  const sessions = allSessions.filter((s) => signedUpIds.has(s.discordUserId));
  const orphanIds = allSessions
    .filter((s) => !signedUpIds.has(s.discordUserId))
    .map((s) => s.id);
  if (orphanIds.length > 0) {
    await db
      .delete(schema.eventVoiceSessions)
      .where(
        sql`${schema.eventVoiceSessions.id} IN (${sql.join(orphanIds, sql`, `)})`,
      );
  }
  return { sessions, orphanCount: orphanIds.length };
}

async function getSignedUpDiscordIds(
  db: Db,
  eventId: number,
): Promise<Set<string>> {
  const signups = await db
    .select({ discordUserId: schema.eventSignups.discordUserId })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        sql`${schema.eventSignups.discordUserId} IS NOT NULL`,
      ),
    );
  return new Set(
    signups.map((s) => s.discordUserId).filter(Boolean) as string[],
  );
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
  const trackedIds = new Set(existingSessions.map((s) => s.discordUserId));
  const signups = await db
    .select()
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        sql`${schema.eventSignups.discordUserId} IS NOT NULL`,
        sql`${schema.eventSignups.status} IN ('signed_up', 'tentative')`,
      ),
    );
  const noShowRows = buildNoShowRows(eventId, signups, trackedIds, event);
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
  trackedIds: Set<string>,
  event: typeof schema.events.$inferSelect,
) {
  return signups
    .filter((s) => s.discordUserId && !trackedIds.has(s.discordUserId))
    .map((s) => ({
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
    }));
}

/** Auto-populate attendance from classified sessions. */
export async function autoPopulateAttendance(
  db: Db,
  eventId: number,
  logger: Logger,
): Promise<void> {
  const sessions = await db
    .select()
    .from(schema.eventVoiceSessions)
    .where(
      and(
        eq(schema.eventVoiceSessions.eventId, eventId),
        sql`${schema.eventVoiceSessions.classification} IS NOT NULL`,
      ),
    );
  if (sessions.length === 0) {
    logger.log(
      `Auto-populated attendance for event ${eventId} from 0 voice session(s)`,
    );
    return;
  }
  const now = new Date();
  await batchUpdateAttendance(db, eventId, sessions, now);
  logger.log(
    `Auto-populated attendance for event ${eventId} from ${sessions.length} voice session(s)`,
  );
}

async function batchUpdateAttendance(
  db: Db,
  eventId: number,
  sessions: Session[],
  now: Date,
): Promise<void> {
  const noShowIds = sessions
    .filter((s) => s.classification === 'no_show')
    .map((s) => s.discordUserId);
  const attendedIds = sessions
    .filter((s) => s.classification !== 'no_show')
    .map((s) => s.discordUserId);
  if (attendedIds.length > 0) {
    await setAttendanceStatus(db, eventId, attendedIds, 'attended', now);
  }
  if (noShowIds.length > 0) {
    await setAttendanceStatus(db, eventId, noShowIds, 'no_show', now);
  }
}

async function setAttendanceStatus(
  db: Db,
  eventId: number,
  discordUserIds: string[],
  status: string,
  now: Date,
): Promise<void> {
  await db
    .update(schema.eventSignups)
    .set({ attendanceStatus: status, attendanceRecordedAt: now })
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        sql`${schema.eventSignups.discordUserId} IN (${sql.join(discordUserIds, sql`, `)})`,
        isNull(schema.eventSignups.attendanceStatus),
      ),
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
  const sec = Math.floor(
    (event.duration[1].getTime() - event.duration[0].getTime()) / 1000,
  );
  if (sec <= 0) return;
  const { sessions, orphanCount } = await loadAndFilterSessions(db, eventId);
  if (orphanCount > 0) {
    logger.log(`Removed ${orphanCount} voice session(s) for non-signed-up users in event ${eventId}`);
  }
  if (sessions.length > 0) {
    await batchClassifySessions(db, sessions, event.duration[0], event.duration[1], sec, graceMs);
  }
  await classifyNoShows(db, eventId, sessions, event);
  logger.log(`Classified ${sessions.length} voice session(s) for event ${eventId}`);
}

/** Check if an event should be classified. */
export async function shouldClassifyEvent(
  db: Db,
  eventId: number,
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
  if (!hasUnclassified && !hasSignups) return false;
  if (!hasUnclassified && hasSignups) {
    const [sessionCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.eventVoiceSessions)
      .where(eq(schema.eventVoiceSessions.eventId, eventId));
    if (sessionCount && sessionCount.count > 0) return false;
  }
  return true;
}
