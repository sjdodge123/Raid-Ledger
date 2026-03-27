/**
 * Live no-show detection query helpers.
 * Extracted from live-noshow.service.ts for file size compliance (ROK-711).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and, sql, inArray, notInArray } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { resolveEventCapacity } from '../events/signups-signup.helpers';

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
  slotConfig: unknown;
  maxAttendees: number | null;
}

/** Map a raw event row to the LiveEvent shape. */
function mapToLiveEvent(r: {
  id: number;
  title: string;
  creatorId: number;
  gameId: number | null;
  recurrenceGroupId: string | null;
  duration: [Date, Date];
  slotConfig: unknown;
  maxAttendees: number | null;
}): LiveEvent {
  return {
    id: r.id,
    title: r.title,
    creatorId: r.creatorId,
    gameId: r.gameId,
    recurrenceGroupId: r.recurrenceGroupId,
    startTime: r.duration[0],
    endTime: r.duration[1],
    slotConfig: r.slotConfig,
    maxAttendees: r.maxAttendees,
  };
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
      slotConfig: schema.events.slotConfig,
      maxAttendees: schema.events.maxAttendees,
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
  return rows.map(mapToLiveEvent);
}

/**
 * Check if the event roster is at capacity.
 * Returns false when no capacity is configured (suppresses Phase 2).
 * Uses same exclusion set as wasEventFullBeforeDeparture.
 */
export async function isRosterAtCapacity(
  db: PostgresJsDatabase<typeof schema>,
  event: LiveEvent,
): Promise<boolean> {
  const capacity = resolveEventCapacity(event);
  if (capacity === null) return false;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, event.id),
        notInArray(schema.eventSignups.status, [
          'departed',
          'declined',
          'roached_out',
        ]),
      ),
    )
    .limit(1);
  return Number(count) >= capacity;
}

type AbsentPlayer = {
  userId: number | null;
  discordUserId: string | null;
  discordUsername: string | null;
};

/** Fetch non-bench signed-up players for an event. */
async function fetchNonBenchSignups(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
) {
  return db
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
}

/** Batch-resolve discord IDs for signups that lack one, falling back to user table. */
async function batchResolveDiscordIds(
  db: PostgresJsDatabase<typeof schema>,
  signups: AbsentPlayer[],
): Promise<Map<number, string>> {
  const needLookup = signups.filter((s) => !s.discordUserId && s.userId);
  const userIds = needLookup.map((s) => s.userId!);
  if (userIds.length === 0) return new Map();
  const users = await db
    .select({ id: schema.users.id, discordId: schema.users.discordId })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds));
  return new Map(
    users.filter((u) => u.discordId !== null).map((u) => [u.id, u.discordId!]),
  );
}

/** Batch-fetch voice session durations for an event. */
async function batchFetchVoiceSessions(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<Map<string, number>> {
  const sessions = await db
    .select({
      discordUserId: schema.eventVoiceSessions.discordUserId,
      totalDurationSec: schema.eventVoiceSessions.totalDurationSec,
    })
    .from(schema.eventVoiceSessions)
    .where(eq(schema.eventVoiceSessions.eventId, eventId));
  return new Map(sessions.map((s) => [s.discordUserId, s.totalDurationSec]));
}

/** Get signed-up players who have no meaningful voice presence. */
export async function getAbsentSignedUpPlayers(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  isUserActive: (eventId: number, discordId: string) => boolean,
): Promise<AbsentPlayer[]> {
  const signups = await fetchNonBenchSignups(db, eventId);
  if (signups.length === 0) return [];
  const [fallbackDiscordIds, voiceSessions] = await Promise.all([
    batchResolveDiscordIds(db, signups),
    batchFetchVoiceSessions(db, eventId),
  ]);
  const absent: AbsentPlayer[] = [];
  for (const signup of signups) {
    const discordUserId =
      signup.discordUserId ??
      (signup.userId ? fallbackDiscordIds.get(signup.userId) : undefined) ??
      null;
    if (!discordUserId) continue;
    if (isUserActive(eventId, discordUserId)) continue;
    const totalDuration = voiceSessions.get(discordUserId) ?? 0;
    if (totalDuration >= PRESENCE_THRESHOLD_SEC) continue;
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

/** Batch-fetch user display names by ID. */
async function fetchUserDisplayNames(
  db: PostgresJsDatabase<typeof schema>,
  userIds: number[],
) {
  return db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds));
}

/** Batch-fetch roster roles for users in an event. */
async function fetchRosterRoles(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userIds: number[],
) {
  return db
    .select({
      userId: schema.eventSignups.userId,
      role: schema.rosterAssignments.role,
    })
    .from(schema.rosterAssignments)
    .innerJoin(
      schema.eventSignups,
      eq(schema.rosterAssignments.signupId, schema.eventSignups.id),
    )
    .where(
      and(
        eq(schema.rosterAssignments.eventId, eventId),
        inArray(schema.eventSignups.userId, userIds),
      ),
    );
}

/** Batch-fetch display names and roster roles for multiple players. */
export async function batchFetchPlayerDisplayInfo(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userIds: number[],
): Promise<Map<number, { displayName: string; role: string | null }>> {
  if (userIds.length === 0) return new Map();
  const [users, assignments] = await Promise.all([
    fetchUserDisplayNames(db, userIds),
    fetchRosterRoles(db, eventId, userIds),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));
  const roleMap = new Map(
    assignments
      .filter((a) => a.userId !== null)
      .map((a) => [a.userId!, a.role]),
  );
  const result = new Map<
    number,
    { displayName: string; role: string | null }
  >();
  for (const uid of userIds) {
    const user = userMap.get(uid);
    result.set(uid, {
      displayName: user?.displayName ?? user?.username ?? 'Unknown',
      role: roleMap.get(uid) ?? null,
    });
  }
  return result;
}

/** Batch-fetch discord IDs and voice sessions for Phase 2 checking. */
export async function fetchPhase2Data(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userIds: number[],
) {
  const [usersWithDiscord, allVoiceSessions] = await Promise.all([
    db
      .select({ id: schema.users.id, discordId: schema.users.discordId })
      .from(schema.users)
      .where(inArray(schema.users.id, userIds)),
    db
      .select({
        discordUserId: schema.eventVoiceSessions.discordUserId,
        totalDurationSec: schema.eventVoiceSessions.totalDurationSec,
      })
      .from(schema.eventVoiceSessions)
      .where(eq(schema.eventVoiceSessions.eventId, eventId)),
  ]);
  const discordIdByUserId = new Map(
    usersWithDiscord
      .filter((u) => u.discordId !== null)
      .map((u) => [u.id, u.discordId!]),
  );
  const voiceSessionByDiscordId = new Map(
    allVoiceSessions.map((s) => [s.discordUserId, s.totalDurationSec]),
  );
  return { discordIdByUserId, voiceSessionByDiscordId };
}
