import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import * as tables from '../../drizzle/schema';

// Re-export from extracted file for backward compatibility
export { autoSignupParticipant } from './ad-hoc-event.signup-helpers';

/** Build the time-window WHERE conditions for scheduled event suppression. */
function buildTimeConditions(now: Date) {
  const lookbackMs = 30 * 60 * 1000;
  const lookbackTime = new Date(now.getTime() - lookbackMs);
  return [
    eq(tables.events.isAdHoc, false),
    sql`${tables.events.cancelledAt} IS NULL`,
    sql`lower(${tables.events.duration}) <= ${now.toISOString()}::timestamptz`,
    sql`(upper(${tables.events.duration}) >= ${lookbackTime.toISOString()}::timestamptz OR ${tables.events.extendedUntil} >= ${now.toISOString()}::timestamptz)`,
  ] as const;
}

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
  channelId?: string,
): Promise<{ id: number } | undefined> {
  const bindingClause = buildBindingClause(
    bindingId,
    effectiveGameId,
    channelId,
  );
  const [match] = await db
    .select({ id: tables.events.id })
    .from(tables.events)
    .where(and(bindingClause, ...buildTimeConditions(now)))
    .limit(1);
  return match;
}

/** Build the binding/game/channel OR clause for suppression. */
function buildBindingClause(
  bindingId: string,
  effectiveGameId: number | null | undefined,
  channelId?: string,
) {
  const siblingSubquery = channelId
    ? sql`${tables.events.channelBindingId} IN (SELECT id FROM channel_bindings WHERE channel_id = ${channelId} AND binding_purpose = 'game-voice-monitor')`
    : undefined;
  if (effectiveGameId != null && siblingSubquery) {
    return sql`(${tables.events.channelBindingId} = ${bindingId} OR ${tables.events.gameId} = ${effectiveGameId} OR ${siblingSubquery})`;
  }
  if (effectiveGameId != null) {
    return sql`(${tables.events.channelBindingId} = ${bindingId} OR ${tables.events.gameId} = ${effectiveGameId})`;
  }
  if (siblingSubquery) {
    return sql`(${tables.events.channelBindingId} = ${bindingId} OR ${siblingSubquery})`;
  }
  return eq(tables.events.channelBindingId, bindingId);
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

/** Stale threshold: events whose effective end is > 30 minutes ago. */
const ORPHAN_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Find orphaned ad-hoc events: live or grace_period, not cancelled,
 * whose effective end time is more than 30 minutes in the past.
 */
export async function findOrphanedAdHocEvents(
  db: PostgresJsDatabase<typeof schema>,
): Promise<(typeof tables.events.$inferSelect)[]> {
  const cutoff = new Date(Date.now() - ORPHAN_THRESHOLD_MS);
  return db
    .select()
    .from(tables.events)
    .where(
      and(
        eq(tables.events.isAdHoc, true),
        inArray(tables.events.adHocStatus, ['live', 'grace_period']),
        sql`${tables.events.cancelledAt} IS NULL`,
        sql`COALESCE(${tables.events.extendedUntil}, upper(${tables.events.duration})) < ${cutoff.toISOString()}::timestamptz`,
      ),
    );
}

/**
 * Force-claim an orphaned event (live or grace_period -> ended).
 * Returns the claimed event row, or null if already claimed.
 */
export async function forceClaimOrphanedEvent(
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
        inArray(tables.events.adHocStatus, ['live', 'grace_period']),
      ),
    )
    .returning();
  return claimed ?? null;
}
