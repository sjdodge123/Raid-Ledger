/**
 * ROK-1624 — who the EVENT CREATED embed is allowed to name.
 *
 * Two lists used to be the same list and no longer are. ROK-1610 made the
 * lock-in roster ONLY the voters of the slot being locked in (so a non-voting
 * organiser stays off the event), while the embed kept naming
 * `findMatchMemberUsers` — every row of `community_lineup_match_members`.
 * A 12-person group whose poll 5 people answered announced 12 players for a
 * 5-person event.
 *
 * The event's own signups are the source of truth here rather than the slot's
 * votes: a signup that failed (they are swallowed one-by-one in
 * `autoSignupSlotVoters`) leaves the voter off the roster, and the card must
 * follow the roster, not the intent.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { activeUsersFilter } from '../users/users-active.helpers';
import { ACTIVE_SIGNUP_STATUSES } from './scheduling/scheduling-availability-busy.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** One rostered player, as the embed needs them. */
export interface EventRosterUser {
  userId: number;
  displayName: string;
}

/**
 * The RL members actually signed up for an event.
 *
 * `declined` / `roached_out` / `departed` have released their spot, so they
 * are not on the roster — the same `ACTIVE_SIGNUP_STATUSES` the availability
 * heatmap uses, one constant so the two cannot drift. Anonymous Discord
 * participants (`user_id IS NULL`, ROK-137) are dropped by the join; none can
 * exist on a just-created lock-in event.
 */
export async function findEventRosterUsers(
  db: Db,
  eventId: number,
): Promise<EventRosterUser[]> {
  return await db
    .select({
      userId: schema.users.id,
      displayName: sql<string>`COALESCE(${schema.users.displayName}, ${schema.users.username})`,
    })
    .from(schema.eventSignups)
    .innerJoin(schema.users, eq(schema.users.id, schema.eventSignups.userId))
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        inArray(schema.eventSignups.status, [...ACTIVE_SIGNUP_STATUSES]),
        activeUsersFilter(),
      ),
    );
}

/**
 * Names for the embed's Players field: the event's roster when there is an
 * event to read, the match group only when there is not.
 *
 * The `undefined` branch is the notification firing without a linked event id
 * (`notifyEventCreated`'s `eventId` is optional). There is no roster to read
 * in that case, so the group list stands — it is the only list that exists,
 * and that card carries no "Open event" link either (AC2: the one remaining
 * caller that passes a group-wide list, documented rather than changed).
 *
 * @param groupMembers - `findMatchMemberUsers` rows; the whole match group.
 */
export async function resolveEventRosterNames(
  db: Db,
  eventId: number | undefined,
  groupMembers: ReadonlyArray<{ displayName: string }>,
): Promise<string[]> {
  if (eventId === undefined) return groupMembers.map((m) => m.displayName);
  const roster = await findEventRosterUsers(db, eventId);
  return roster.map((r) => r.displayName);
}
