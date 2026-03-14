import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import * as tables from '../../drizzle/schema';
import type { VoiceMemberInfo } from './ad-hoc-participant.service';

/**
 * Check if a scheduled (non-ad-hoc) event is currently active for the same
 * game/binding, suppressing ad-hoc spawns while scheduled events run.
 * Returns the matching scheduled event row or undefined.
 */
export async function findActiveScheduledEvent(
  db: PostgresJsDatabase<typeof schema>,
  bindingId: string,
  effectiveGameId: number | null | undefined,
  now: Date,
): Promise<{ id: number } | undefined> {
  const lookbackMs = 30 * 60 * 1000;
  const lookbackTime = new Date(now.getTime() - lookbackMs);

  const [match] = await db
    .select({
      id: tables.events.id,
      extendedUntil: tables.events.extendedUntil,
    })
    .from(tables.events)
    .where(
      and(
        effectiveGameId
          ? sql`(${tables.events.channelBindingId} = ${bindingId} OR ${tables.events.gameId} = ${effectiveGameId})`
          : eq(tables.events.channelBindingId, bindingId),
        eq(tables.events.isAdHoc, false),
        sql`${tables.events.cancelledAt} IS NULL`,
        sql`lower(${tables.events.duration}) <= ${now.toISOString()}::timestamptz`,
        sql`(upper(${tables.events.duration}) >= ${lookbackTime.toISOString()}::timestamptz OR ${tables.events.extendedUntil} >= ${now.toISOString()}::timestamptz)`,
      ),
    )
    .limit(1);

  return match;
}

/**
 * Extend a scheduled event's suppression window so ad-hoc events don't
 * spawn while members are still in the channel.
 */
export async function extendScheduledEventWindow(
  db: PostgresJsDatabase<typeof schema>,
  scheduledEventId: number,
  currentExtended: Date | null,
  now: Date,
): Promise<void> {
  const newEnd = new Date(now.getTime() + 60 * 60 * 1000);
  if (!currentExtended || currentExtended < newEnd) {
    await db
      .update(tables.events)
      .set({ extendedUntil: newEnd, updatedAt: now })
      .where(eq(tables.events.id, scheduledEventId));
  }
}

/**
 * Resolve a game name from the games table by ID.
 */
export async function resolveGameName(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
): Promise<string | undefined> {
  const [game] = await db
    .select({ name: tables.games.name })
    .from(tables.games)
    .where(eq(tables.games.id, gameId))
    .limit(1);
  return game?.name;
}

/**
 * Auto-create a signup and roster slot for an ad-hoc participant.
 * Idempotent: skips if the participant already has a signup.
 */
export async function autoSignupParticipant(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  member: VoiceMemberInfo,
): Promise<void> {
  // Check if signup already exists (re-join case)
  const [existing] = await db
    .select({ id: tables.eventSignups.id })
    .from(tables.eventSignups)
    .where(
      and(
        eq(tables.eventSignups.eventId, eventId),
        eq(tables.eventSignups.discordUserId, member.discordUserId),
      ),
    )
    .limit(1);

  if (existing) return;

  const signup = await insertSignup(db, eventId, member);
  if (!signup) return;

  await assignSlot(db, eventId, signup.id);
}

/**
 * Insert a signup row for an ad-hoc participant.
 */
async function insertSignup(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  member: VoiceMemberInfo,
): Promise<{ id: number } | null> {
  const [signup] = await db
    .insert(tables.eventSignups)
    .values({
      eventId,
      userId: member.userId,
      discordUserId: member.discordUserId,
      discordUsername: member.discordUsername,
      discordAvatarHash: member.discordAvatarHash,
      confirmationStatus: 'confirmed',
      status: 'signed_up',
    })
    .onConflictDoNothing()
    .returning({ id: tables.eventSignups.id });

  return signup ?? null;
}

/**
 * Assign a signup to the next available player or bench slot.
 */
async function assignSlot(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
): Promise<void> {
  const maxPlayers = 25;
  const maxBench = 10;

  const playerSlot = await findNextSlot(db, eventId, 'player', maxPlayers);
  if (playerSlot) {
    await db.insert(tables.rosterAssignments).values({
      eventId,
      signupId,
      role: 'player',
      position: playerSlot,
      isOverride: 0,
    });
    return;
  }

  const benchSlot = await findNextSlot(db, eventId, 'bench', maxBench);
  if (benchSlot) {
    await db.insert(tables.rosterAssignments).values({
      eventId,
      signupId,
      role: 'bench',
      position: benchSlot,
      isOverride: 0,
    });
  }
}

/**
 * Find the next available position for a given role.
 */
async function findNextSlot(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  role: string,
  max: number,
): Promise<number | null> {
  const existing = await db
    .select({ position: tables.rosterAssignments.position })
    .from(tables.rosterAssignments)
    .where(
      and(
        eq(tables.rosterAssignments.eventId, eventId),
        eq(tables.rosterAssignments.role, role),
      ),
    );

  const used = new Set(existing.map((s) => s.position));
  let pos = 1;
  while (used.has(pos) && pos <= max) pos++;
  return pos <= max ? pos : null;
}

/**
 * Create a new ad-hoc event in the database.
 */
export async function createAdHocEventRow(
  db: PostgresJsDatabase<typeof schema>,
  bindingId: string,
  binding: { gameId: number | null },
  creatorId: number,
  resolvedGameName?: string,
): Promise<number> {
  const title = await buildAdHocTitle(db, binding.gameId, resolvedGameName);
  const now = new Date();
  const [event] = await db
    .insert(tables.events)
    .values(
      buildAdHocEventValues(title, binding.gameId, creatorId, bindingId, now),
    )
    .returning();
  return event.id;
}

/** Build the title for an ad-hoc event. */
async function buildAdHocTitle(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number | null,
  resolvedGameName?: string,
): Promise<string> {
  let gameName = 'Gaming';
  if (gameId) {
    const name = await resolveGameName(db, gameId);
    if (name) gameName = name;
  }
  if (gameName === 'Gaming' && resolvedGameName) {
    gameName = resolvedGameName;
  }
  return `${gameName} — Quick Play`;
}

/** Build the insert values for a new ad-hoc event. */
function buildAdHocEventValues(
  title: string,
  gameId: number | null,
  creatorId: number,
  bindingId: string,
  now: Date,
): typeof tables.events.$inferInsert {
  return {
    title,
    gameId,
    creatorId,
    duration: [now, new Date(now.getTime() + 60 * 60 * 1000)],
    slotConfig: { type: 'generic', player: 25, bench: 10 },
    maxAttendees: null,
    isAdHoc: true,
    adHocStatus: 'live',
    channelBindingId: bindingId,
    reminder15min: false,
    reminder1hour: false,
    reminder24hour: false,
  };
}

/**
 * Find a fallback admin user for ad-hoc event creation.
 */
export async function findAdminFallback(
  db: PostgresJsDatabase<typeof schema>,
): Promise<number | null> {
  const [admin] = await db
    .select({ id: tables.users.id })
    .from(tables.users)
    .where(eq(tables.users.role, 'admin'))
    .limit(1);

  return admin?.id ?? null;
}

/** Recover live ad-hoc events from DB. */
export async function recoverLiveEvents(
  db: PostgresJsDatabase<typeof schema>,
): Promise<(typeof tables.events.$inferSelect)[]> {
  return db
    .select()
    .from(tables.events)
    .where(
      and(
        eq(tables.events.isAdHoc, true),
        sql`${tables.events.adHocStatus} = 'live'`,
        sql`${tables.events.cancelledAt} IS NULL`,
      ),
    );
}

/** Fetch a single event by ID. */
export async function getEventById(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<typeof tables.events.$inferSelect | null> {
  const [event] = await db
    .select()
    .from(tables.events)
    .where(eq(tables.events.id, eventId))
    .limit(1);
  return event ?? null;
}

/** Restore an event from grace_period to live. Returns true if updated. */
export async function restoreFromGracePeriod(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<boolean> {
  const [updated] = await db
    .update(tables.events)
    .set({ adHocStatus: 'live', updatedAt: new Date() })
    .where(
      and(
        eq(tables.events.id, eventId),
        sql`${tables.events.adHocStatus} = 'grace_period'`,
      ),
    )
    .returning({ id: tables.events.id });
  return !!updated;
}

/** Set the event end time to now. */
export async function setEventEndTime(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  event: typeof tables.events.$inferSelect,
  now: Date,
): Promise<void> {
  await db
    .update(tables.events)
    .set({
      duration: [event.duration[0], now] as [Date, Date],
      updatedAt: now,
    })
    .where(eq(tables.events.id, eventId));
}

/** Claim an event for finalization (grace_period -> ended). */
export async function claimAndEndEvent(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  now: Date,
): Promise<typeof tables.events.$inferSelect | null> {
  const [claimed] = await db
    .update(tables.events)
    .set({ adHocStatus: 'ended', updatedAt: now })
    .where(
      and(
        eq(tables.events.id, eventId),
        sql`${tables.events.adHocStatus} = 'grace_period'`,
      ),
    )
    .returning();
  return claimed ?? null;
}

/** Set event status to grace_period. */
export async function setGracePeriodStatus(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<void> {
  await db
    .update(tables.events)
    .set({ adHocStatus: 'grace_period', updatedAt: new Date() })
    .where(eq(tables.events.id, eventId));
}
