/**
 * Voice attendance population helpers.
 * Extracted from voice-attendance-classify.helpers.ts for file size compliance (ROK-985).
 * Handles auto-populating signup attendance from classified voice sessions.
 */
import { eq, and, sql, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
type Logger = {
  log: (msg: string) => void;
  warn: (msg: string) => void;
};
type Session = typeof schema.eventVoiceSessions.$inferSelect;

/**
 * Auto-populate signup attendance statuses from classified voice sessions.
 * Issues updates via both discordUserId and userId to cover all signup paths (ROK-985).
 */
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

/**
 * Batch-update attendance for all classified sessions.
 * Updates via discordUserId first, then via userId for dual-identifier coverage.
 */
async function batchUpdateAttendance(
  db: Db,
  eventId: number,
  sessions: Session[],
  now: Date,
): Promise<void> {
  const noShowIds = sessions.filter((s) => s.classification === 'no_show');
  const attendedIds = sessions.filter((s) => s.classification !== 'no_show');
  await updateByDiscordId(db, eventId, attendedIds, 'attended', now);
  await updateByDiscordId(db, eventId, noShowIds, 'no_show', now);
  await updateByUserId(db, eventId, attendedIds, 'attended', now);
  await updateByUserId(db, eventId, noShowIds, 'no_show', now);
}

/** Update attendance matching signups by discordUserId. */
async function updateByDiscordId(
  db: Db,
  eventId: number,
  sessions: Session[],
  status: string,
  now: Date,
): Promise<void> {
  const ids = sessions.map((s) => s.discordUserId).filter(Boolean);
  if (ids.length === 0) return;
  await db
    .update(schema.eventSignups)
    .set({ attendanceStatus: status, attendanceRecordedAt: now })
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        sql`${schema.eventSignups.discordUserId} IN (${sql.join(ids, sql`, `)})`,
        isNull(schema.eventSignups.attendanceStatus),
      ),
    );
}

/** Update attendance matching signups by userId (ROK-985 dual-identifier path). */
async function updateByUserId(
  db: Db,
  eventId: number,
  sessions: Session[],
  status: string,
  now: Date,
): Promise<void> {
  const ids = sessions
    .map((s) => s.userId)
    .filter((id): id is number => id !== null);
  if (ids.length === 0) return;
  await db
    .update(schema.eventSignups)
    .set({ attendanceStatus: status, attendanceRecordedAt: now })
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        sql`${schema.eventSignups.userId} IN (${sql.join(ids, sql`, `)})`,
        isNull(schema.eventSignups.attendanceStatus),
      ),
    );
}
