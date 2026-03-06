/**
 * Live no-show detection query helpers.
 * Extracted from live-noshow.service.ts for file size compliance (ROK-711).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and, sql, inArray } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

/** Minimum voice presence (seconds) to count as "showed up". */
export const PRESENCE_THRESHOLD_SEC = 120;
/** Phase 1 fires at startTime + 5 minutes. */
export const PHASE1_OFFSET_MS = 5 * 60 * 1000;
/** Phase 2 fires at startTime + 15 minutes. */
export const PHASE2_OFFSET_MS = 15 * 60 * 1000;

/** Canonical event shape used by no-show checks. */
export interface LiveEvent {
  id: number;
  title: string;
  creatorId: number;
  startTime: Date;
  endTime: Date;
  gameId: number | null;
  recurrenceGroupId: string | null;
}

/** Find live scheduled events where now >= startTime + 5 min. */
export async function findLiveEventsInNoShowWindow(
  db: PostgresJsDatabase<typeof schema>,
  now: Date,
): Promise<LiveEvent[]> {
  const phase1Threshold = new Date(now.getTime() - PHASE1_OFFSET_MS);
  const rows = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      creatorId: schema.events.creatorId,
      gameId: schema.events.gameId,
      recurrenceGroupId: schema.events.recurrenceGroupId,
      duration: schema.events.duration,
    })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.isAdHoc, false),
        sql`${schema.events.cancelledAt} IS NULL`,
        sql`lower(${schema.events.duration}) <= ${phase1Threshold.toISOString()}::timestamptz`,
        sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) >= ${now.toISOString()}::timestamptz`,
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    creatorId: r.creatorId,
    gameId: r.gameId,
    recurrenceGroupId: r.recurrenceGroupId,
    startTime: r.duration[0],
    endTime: r.duration[1],
  }));
}

/** Get signed-up players who have no meaningful voice presence. */
export async function getAbsentSignedUpPlayers(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  isUserActive: (eventId: number, discordId: string) => boolean,
): Promise<
  Array<{
    userId: number | null;
    discordUserId: string | null;
    discordUsername: string | null;
  }>
> {
  const signups = await db
    .select({
      userId: schema.eventSignups.userId,
      discordUserId: schema.eventSignups.discordUserId,
      discordUsername: schema.eventSignups.discordUsername,
    })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.status, 'signed_up'),
        sql`NOT EXISTS (SELECT 1 FROM ${schema.rosterAssignments} WHERE ${schema.rosterAssignments.eventId} = ${schema.eventSignups.eventId} AND ${schema.rosterAssignments.signupId} = ${schema.eventSignups.id} AND ${schema.rosterAssignments.role} = 'bench')`,
      ),
    );
  const absent: Array<{
    userId: number | null;
    discordUserId: string | null;
    discordUsername: string | null;
  }> = [];
  for (const signup of signups) {
    let discordUserId = signup.discordUserId;
    if (!discordUserId && signup.userId) {
      const [user] = await db
        .select({ discordId: schema.users.discordId })
        .from(schema.users)
        .where(eq(schema.users.id, signup.userId))
        .limit(1);
      discordUserId = user?.discordId ?? null;
    }
    if (!discordUserId) continue;
    if (isUserActive(eventId, discordUserId)) continue;
    const [voiceSession] = await db
      .select({ totalDurationSec: schema.eventVoiceSessions.totalDurationSec })
      .from(schema.eventVoiceSessions)
      .where(
        and(
          eq(schema.eventVoiceSessions.eventId, eventId),
          eq(schema.eventVoiceSessions.discordUserId, discordUserId),
        ),
      )
      .limit(1);
    if (voiceSession && voiceSession.totalDurationSec >= PRESENCE_THRESHOLD_SEC)
      continue;
    absent.push({ ...signup, discordUserId });
  }
  return absent;
}

/** Get user IDs that received Phase 1 (noshow_reminder) for an event. */
export async function getPhase1RemindedUserIds(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<number[]> {
  const rows = await db
    .select({ userId: schema.eventRemindersSent.userId })
    .from(schema.eventRemindersSent)
    .where(
      and(
        eq(schema.eventRemindersSent.eventId, eventId),
        eq(schema.eventRemindersSent.reminderType, 'noshow_reminder'),
      ),
    );
  return rows.map((r) => r.userId);
}

/** Get display name and roster role for a player in an event. */
export async function getPlayerDisplayInfo(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
): Promise<{ displayName: string; role: string | null }> {
  const [user] = await db
    .select({
      username: schema.users.username,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const displayName = user?.displayName ?? user?.username ?? 'Unknown';
  const [assignment] = await db
    .select({ role: schema.rosterAssignments.role })
    .from(schema.rosterAssignments)
    .innerJoin(
      schema.eventSignups,
      eq(schema.rosterAssignments.signupId, schema.eventSignups.id),
    )
    .where(
      and(
        eq(schema.rosterAssignments.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
      ),
    )
    .limit(1);
  return { displayName, role: assignment?.role ?? null };
}

/** Batch-fetch discord IDs and voice sessions for Phase 2 checking. */
export async function fetchPhase2Data(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userIds: number[],
) {
  const usersWithDiscord = await db
    .select({ id: schema.users.id, discordId: schema.users.discordId })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds));
  const discordIdByUserId = new Map(
    usersWithDiscord
      .filter((u) => u.discordId !== null)
      .map((u) => [u.id, u.discordId!]),
  );
  const allVoiceSessions = await db
    .select({
      discordUserId: schema.eventVoiceSessions.discordUserId,
      totalDurationSec: schema.eventVoiceSessions.totalDurationSec,
    })
    .from(schema.eventVoiceSessions)
    .where(eq(schema.eventVoiceSessions.eventId, eventId));
  const voiceSessionByDiscordId = new Map(
    allVoiceSessions.map((s) => [s.discordUserId, s.totalDurationSec]),
  );
  return { discordIdByUserId, voiceSessionByDiscordId };
}
