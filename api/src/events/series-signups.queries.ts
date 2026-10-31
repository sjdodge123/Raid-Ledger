/**
 * Repository queries for series memberships (ROK-1728).
 *
 * Plain functions over `db: Tx`, Drizzle builder only. The raw `sql`
 * fragments are same-table predicates on `events.duration` (never a
 * correlated subquery — see memory reference_drizzle_raw_sql_unqualified_columns).
 */
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from 'drizzle-orm';
import type {
  SeriesSignupEndedReason,
  SeriesSignupStatus,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { defined } from '../common/defined.helpers';
import type { Tx } from './signups.service.types';
import {
  ACTIVE_SIGNUP_STATUSES,
  selectJoinableNights,
  type JoinableNight,
  type UserSeriesRow,
} from './series-signups-plan.helpers';

/** A `series_signups` row as Drizzle returns it. */
export type SeriesSignupRow = typeof schema.seriesSignups.$inferSelect;

/** A future active signup carrying a series tag. */
export interface TaggedFutureSignup {
  signupId: number;
  eventId: number;
  startTime: Date;
}

/** Fields written when a user joins a series. */
export interface NewMembership {
  groupId: string;
  userId: number;
  characterId: string | null;
  preferredRoles: string[] | null;
}

const ms = schema.seriesSignups;
const es = schema.eventSignups;
const ev = schema.events;

/** `lower(events.duration) > now` as a builder predicate. */
function startsAfter(now: Date): SQL {
  return sql`lower(${ev.duration}) > ${now.toISOString()}::timestamptz`;
}

/** The user's ACTIVE membership of the group, or `undefined`. */
export async function findActiveMembership(
  db: Tx,
  groupId: string,
  userId: number,
): Promise<SeriesSignupRow | undefined> {
  const [row] = await db
    .select()
    .from(ms)
    .where(
      and(
        eq(ms.recurrenceGroupId, groupId),
        eq(ms.userId, userId),
        eq(ms.status, 'active'),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Inserts an active membership. A concurrent join violates
 * `uq_series_signups_active`; the CALLER maps that to 409 (not in a tx).
 */
export async function insertMembership(
  db: Tx,
  input: NewMembership,
): Promise<SeriesSignupRow> {
  const [row] = await db
    .insert(ms)
    .values({
      recurrenceGroupId: input.groupId,
      userId: input.userId,
      characterId: input.characterId,
      preferredRoles: input.preferredRoles,
    })
    .returning();
  return defined(row, 'inserted series_signups row');
}

/** Ends one ACTIVE membership; `undefined` when it was not active. */
export async function endMembership(
  db: Tx,
  id: number,
  status: Exclude<SeriesSignupStatus, 'active'>,
  reason: SeriesSignupEndedReason,
): Promise<SeriesSignupRow | undefined> {
  const [row] = await db
    .update(ms)
    .set({ status, endedReason: reason, endedAt: new Date() })
    .where(and(eq(ms.id, id), eq(ms.status, 'active')))
    .returning();
  return row;
}

/** Bulk-ends every active membership of a user (status `ended`); returns ids. */
export async function endActiveMembershipsForUser(
  db: Tx,
  userId: number,
  reason: SeriesSignupEndedReason,
): Promise<number[]> {
  const rows = await db
    .update(ms)
    .set({ status: 'ended', endedReason: reason, endedAt: new Date() })
    .where(and(eq(ms.userId, userId), eq(ms.status, 'active')))
    .returning({ id: ms.id });
  return rows.map((r) => r.id);
}

/** Bulk-ends every active membership of a group (status `ended`); returns ids. */
export async function endActiveMembershipsForGroup(
  db: Tx,
  groupId: string,
  reason: SeriesSignupEndedReason,
): Promise<number[]> {
  const rows = await db
    .update(ms)
    .set({ status: 'ended', endedReason: reason, endedAt: new Date() })
    .where(and(eq(ms.recurrenceGroupId, groupId), eq(ms.status, 'active')))
    .returning({ id: ms.id });
  return rows.map((r) => r.id);
}

/**
 * Future, non-cancelled occurrences of the group from `fromStart` (inclusive)
 * forward, ordered by start. The group is ≤ 52 rows, so the anchor / now /
 * cancelled filtering is the unit-tested pure `selectJoinableNights`.
 */
export async function findJoinableNights(
  db: Tx,
  groupId: string,
  fromStart: Date,
  now: Date,
): Promise<JoinableNight[]> {
  const rows = await db
    .select({ id: ev.id, duration: ev.duration, cancelledAt: ev.cancelledAt })
    .from(ev)
    .where(eq(ev.recurrenceGroupId, groupId))
    .orderBy(sql`lower(${ev.duration})`);
  const occurrences = rows.map((r) => ({
    eventId: r.id,
    startTime: r.duration[0],
    cancelledAt: r.cancelledAt,
  }));
  return selectJoinableNights(occurrences, fromStart, now);
}

/** The user's signup rows (any status) on the given events. */
export async function findUserRowsForEvents(
  db: Tx,
  userId: number,
  eventIds: number[],
): Promise<UserSeriesRow[]> {
  if (eventIds.length === 0) return [];
  return db
    .select({
      id: es.id,
      eventId: es.eventId,
      status: es.status,
      seriesSignupId: es.seriesSignupId,
    })
    .from(es)
    .where(and(eq(es.userId, userId), inArray(es.eventId, eventIds)));
}

/**
 * Tags ACTIVE, UNTAGGED rows with the membership. Touches no other column
 * (AC2a). Returns the event ids actually attached.
 */
export async function attachSignups(
  db: Tx,
  signupIds: number[],
  membershipId: number,
): Promise<number[]> {
  if (signupIds.length === 0) return [];
  const rows = await db
    .update(es)
    .set({ seriesSignupId: membershipId })
    .where(
      and(
        inArray(es.id, signupIds),
        inArray(es.status, [...ACTIVE_SIGNUP_STATUSES]),
        isNull(es.seriesSignupId),
      ),
    )
    .returning({ eventId: es.eventId });
  return rows.map((r) => r.eventId);
}

/** D3 post-tag of a freshly created signup; `true` when the row was tagged. */
export async function tagSignup(
  db: Tx,
  signupId: number,
  membershipId: number,
): Promise<boolean> {
  const rows = await db
    .update(es)
    .set({ seriesSignupId: membershipId })
    .where(and(eq(es.id, signupId), isNull(es.seriesSignupId)))
    .returning({ id: es.id });
  return rows.length > 0;
}

/** Active signups tagged by `membershipId` on nights starting after `now`. */
export async function findTaggedFutureActiveSignups(
  db: Tx,
  membershipId: number,
  now: Date,
): Promise<TaggedFutureSignup[]> {
  return selectTaggedFuture(db, eq(es.seriesSignupId, membershipId), now);
}

/** Active signups of the user tagged by ANY membership, starting after `now`. */
export async function findFutureTaggedSignupsForUser(
  db: Tx,
  userId: number,
  now: Date,
): Promise<TaggedFutureSignup[]> {
  return selectTaggedFuture(
    db,
    and(eq(es.userId, userId), isNotNull(es.seriesSignupId)),
    now,
  );
}

/** Shared body of the two tagged-future reads (signups ⋈ events). */
async function selectTaggedFuture(
  db: Tx,
  tagFilter: SQL | undefined,
  now: Date,
): Promise<TaggedFutureSignup[]> {
  const rows = await db
    .select({ signupId: es.id, eventId: es.eventId, duration: ev.duration })
    .from(es)
    .innerJoin(ev, eq(ev.id, es.eventId))
    .where(
      and(
        tagFilter,
        inArray(es.status, [...ACTIVE_SIGNUP_STATUSES]),
        startsAfter(now),
      ),
    )
    .orderBy(asc(es.eventId));
  return rows.map((r) => ({
    signupId: r.signupId,
    eventId: r.eventId,
    startTime: r.duration[0],
  }));
}

/** D9 untag: clears `series_signup_id` on the given signups. */
export async function clearFutureTags(
  db: Tx,
  signupIds: number[],
): Promise<void> {
  if (signupIds.length === 0) return;
  await db
    .update(es)
    .set({ seriesSignupId: null })
    .where(inArray(es.id, signupIds));
}

/** Non-cancelled occurrences of the group starting after `now`. */
export async function countRemainingNights(
  db: Tx,
  groupId: string,
  now: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(ev)
    .where(
      and(
        eq(ev.recurrenceGroupId, groupId),
        isNull(ev.cancelledAt),
        startsAfter(now),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Lead ruling on D9: clears the tag on EVERY future row of the given
 * memberships, whatever its status, so no dead tag survives a leave or a
 * system end. Past rows keep the tag as history. Returns the rows untagged.
 */
export async function clearFutureTagsForMemberships(
  db: Tx,
  membershipIds: number[],
  now: Date,
): Promise<number> {
  if (membershipIds.length === 0) return 0;
  // Joined select: Drizzle qualifies `events.duration` in startsAfter.
  const tagged = await db
    .select({ id: es.id })
    .from(es)
    .innerJoin(ev, eq(ev.id, es.eventId))
    .where(and(inArray(es.seriesSignupId, membershipIds), startsAfter(now)));
  const ids = tagged.map((r) => r.id);
  await clearFutureTags(db, ids);
  return ids.length;
}
