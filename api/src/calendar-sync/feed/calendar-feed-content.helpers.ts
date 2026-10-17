/**
 * ROK-1599: what a user's ICS subscribe feed contains (epic ROK-669 §10
 * Story 9, ruling Q10 + OPERATOR-2).
 *
 * - Window: events overlapping [now − 7 days, now + 90 days).
 * - Sign-ups `signed_up` and `tentative` (the write path's set); cancelled
 *   events are left out (the write path deletes their copies).
 * - ROK-1807: an event under a rescheduling poll (`rescheduling_poll_id` set)
 *   is left out while the poll runs — its old time is no longer committed —
 *   and returns at the new time once the poll resolves and clears the column.
 * - Presentation is the write path's (D4 + F11): "(Tentative) " / "(Bench) "
 *   titles and Free (TRANSP:TRANSPARENT); a confirmed sign-up is Busy.
 * - UID is the shared copy id `rl:<instance>:<event>:<user>`, so a feed seen
 *   inside a read-connected calendar is recognised as ours (R3).
 * Bounds come from the zone-less `events.duration` tsrange (UTC wall clock).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { parseTimestampUtc, utcIsoText } from '../../drizzle/timestamp-utils';
import {
  copyIsBusy,
  copySummary,
} from '../providers/copy-presentation.helpers';
import { buildCopyId, deriveInstanceId } from '../providers/rl-copy-id.helpers';
import {
  COPY_FOOTER,
  eventPageUrl,
} from '../write/calendar-write-copy.helpers';
import type { IcsCalendar, IcsEvent } from './ics-serialize.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export const FEED_PAST_DAYS = 7;
export const FEED_FUTURE_DAYS = 90;
export const FEED_PROD_ID = '-//Raid Ledger//Feed//EN';
/** Calendar display name (`X-WR-CALNAME`). */
export const FEED_NAME = 'Raid Ledger';
/** Suggested poll interval; most clients ignore it and use their own. */
export const FEED_REFRESH_INTERVAL = 'PT1H';
/** Sign-up statuses that put an event in the feed (= the write path's). */
export const FEED_SIGNUP_STATUSES = ['signed_up', 'tentative'] as const;

const DAY_MS = 86_400_000;

export interface FeedEntry {
  eventId: number;
  title: string;
  start: Date;
  end: Date;
  tentative: boolean;
  benched: boolean;
}

/** The [from, to) window the feed covers at `now`. */
export function feedWindow(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() - FEED_PAST_DAYS * DAY_MS),
    to: new Date(now.getTime() + FEED_FUTURE_DAYS * DAY_MS),
  };
}

interface FeedRow {
  eventId: number;
  title: string;
  status: string;
  start: string;
  end: string;
  benched: boolean;
}

function toFeedEntry(row: FeedRow): FeedEntry {
  return {
    eventId: row.eventId,
    title: row.title,
    start: parseTimestampUtc(row.start),
    end: parseTimestampUtc(row.end),
    tentative: row.status === 'tentative',
    benched: row.benched === true,
  };
}

/** F11: the sign-up sits on the bench (a roster role, not a signup status). */
const benchedSql = () => {
  const ra = schema.rosterAssignments;
  return sql<boolean>`exists (select 1 from ${ra} where ${ra.signupId} = ${schema.eventSignups.id} and ${ra.role} = 'bench')`;
};

/** Which sign-ups make the feed: status, live event, inside the window. */
function feedWhere(userId: number, now: Date) {
  const s = schema.eventSignups;
  const e = schema.events;
  const { from, to } = feedWindow(now);
  return and(
    eq(s.userId, userId),
    inArray(s.status, [...FEED_SIGNUP_STATUSES]),
    isNull(e.cancelledAt),
    isNull(e.reschedulingPollId),
    sql`${e.duration} && ${`[${from.toISOString()},${to.toISOString()})`}::tsrange`,
  );
}

/** The user's feed rows, earliest first. One row per sign-up. */
export async function loadFeedEntries(
  db: Db,
  userId: number,
  now: Date,
): Promise<FeedEntry[]> {
  const s = schema.eventSignups;
  const e = schema.events;
  const rows = await db
    .select({
      eventId: e.id,
      title: e.title,
      status: s.status,
      start: utcIsoText(sql`lower(${e.duration})`),
      end: utcIsoText(sql`upper(${e.duration})`),
      benched: benchedSql(),
    })
    .from(s)
    .innerJoin(e, eq(s.eventId, e.id))
    .where(feedWhere(userId, now))
    .orderBy(sql`lower(${e.duration})`, e.id);
  return rows.map(toFeedEntry);
}

export interface FeedCalendarOptions {
  clientUrl: string;
  userId: number;
  now: Date;
}

function toIcsEvent(
  entry: FeedEntry,
  instanceId: string,
  opts: FeedCalendarOptions,
): IcsEvent {
  const url = eventPageUrl(opts.clientUrl, entry.eventId);
  return {
    uid: buildCopyId({
      instanceId,
      eventId: entry.eventId,
      userId: opts.userId,
    }),
    start: entry.start,
    end: entry.end,
    summary: copySummary(entry),
    stamp: opts.now,
    description: `${url}\n\n${COPY_FOOTER}`,
    url,
    // §6.3/§4: STATUS follows the sign-up — a tentative one (benched or not)
    // is TENTATIVE, everything else CONFIRMED. The (Bench) prefix and Free
    // come from the shared copy helpers above.
    status: entry.tentative ? 'TENTATIVE' : 'CONFIRMED',
    transparency: copyIsBusy(entry) ? 'OPAQUE' : 'TRANSPARENT',
  };
}

/** The whole VCALENDAR for one user's feed (serialize with the ICS writer). */
export function buildFeedCalendar(
  entries: FeedEntry[],
  opts: FeedCalendarOptions,
): IcsCalendar {
  const instanceId = deriveInstanceId(new URL(opts.clientUrl).host);
  return {
    prodId: FEED_PROD_ID,
    name: FEED_NAME,
    refreshInterval: FEED_REFRESH_INTERVAL,
    events: entries.map((entry) => toIcsEvent(entry, instanceId, opts)),
  };
}
