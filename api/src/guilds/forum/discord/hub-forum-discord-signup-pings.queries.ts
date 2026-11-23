/**
 * ROK-2260 — the reads behind signup pings: the event's live thread in a hub
 * bound to a Discord forum (or, ROK-2272 S4b, a non-hub event's registry
 * post), the event's signups (with each signer's Discord id), and the
 * upcoming events the one-time deploy catch-up flushes.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { SignupPingRow } from './hub-forum-discord-signup-pings';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

const threads = schema.hubForumThreads;
const events = schema.events;
const bindings = schema.hubForumDiscordBindings;
const signups = schema.eventSignups;
const users = schema.users;
const planningPosts = schema.eventPlanningPosts;

/** What every ping target carries. */
interface PingTiming {
  /** The event's scheduled end (the pinged set expires after it). */
  endsAt: Date;
  /** A cancelled event pings nobody new (review r1 m4); removals still run. */
  cancelled: boolean;
}

/** The event's live thread, in a hub bound to a Discord forum. */
export interface HubPingThreadRef extends PingTiming {
  kind: 'hub';
  guildId: number;
  threadId: number;
}

/** A non-hub event's live registry post (`event_planning_posts`). */
export interface PlanningPingPost {
  id: number;
  discordThreadId: string;
  locked: boolean;
}

/**
 * ROK-2272 S4b — a NON-HUB, non-ad-hoc event: its Discord-only post in the
 * event-planning forum. `post` is null until the first line creates it.
 */
export interface PlanningPingThreadRef extends PingTiming {
  kind: 'planning';
  eventId: number;
  post: PlanningPingPost | null;
}

/** Where an event's signup lines go. */
export type PingThreadRef = HubPingThreadRef | PlanningPingThreadRef;

const notEnded = (now: Date) =>
  sql`upper(${events.duration}) > ${now.toISOString()}::timestamp`;

/** The event's attached thread when its hub is bound; null otherwise. */
export async function findBoundEventThread(
  db: ForumDiscordDb,
  eventId: number,
): Promise<HubPingThreadRef | null> {
  const [row] = await db
    .select({
      guildId: threads.guildId,
      threadId: threads.id,
      duration: events.duration,
      cancelledAt: events.cancelledAt,
    })
    .from(threads)
    .innerJoin(events, eq(events.id, threads.eventId))
    .innerJoin(bindings, eq(bindings.guildId, threads.guildId))
    .where(and(eq(threads.eventId, eventId), isNull(threads.eventDetachedAt)))
    .limit(1);
  if (!row) return null;
  return {
    kind: 'hub',
    guildId: row.guildId,
    threadId: row.threadId,
    endsAt: row.duration[1],
    cancelled: row.cancelledAt !== null,
  };
}

/** The event's live registry post row, joined in when there is one. */
const livePlanningPost = and(
  eq(planningPosts.subjectKind, 'event'),
  eq(planningPosts.subjectId, events.id),
  isNull(planningPosts.discordDeletedAt),
);

/** A non-hub, non-ad-hoc event's ping target; null for any other event. */
export async function findPlanningEventThread(
  db: ForumDiscordDb,
  eventId: number,
): Promise<PlanningPingThreadRef | null> {
  const [row] = await db
    .select({
      guildId: events.guildId,
      isAdHoc: events.isAdHoc,
      duration: events.duration,
      cancelledAt: events.cancelledAt,
      postId: planningPosts.id,
      discordThreadId: planningPosts.discordThreadId,
      lockedAt: planningPosts.discordLockedAt,
    })
    .from(events)
    .leftJoin(planningPosts, livePlanningPost)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!row || row.guildId !== null || row.isAdHoc) return null;
  return {
    kind: 'planning',
    eventId,
    endsAt: row.duration[1],
    cancelled: row.cancelledAt !== null,
    post: planningPingPost(row),
  };
}

/** The left-joined registry columns as a post; null when none joined. */
function planningPingPost(row: {
  postId: number | null;
  discordThreadId: string | null;
  lockedAt: Date | null;
}): PlanningPingPost | null {
  const { postId, discordThreadId, lockedAt } = row;
  if (postId === null || discordThreadId === null) return null;
  return { id: postId, discordThreadId, locked: lockedAt !== null };
}

/** Every signup of the event with the signer's Discord id (linked or anonymous). */
export async function listSignupPingRows(
  db: ForumDiscordDb,
  eventId: number,
): Promise<SignupPingRow[]> {
  return db
    .select({
      status: signups.status,
      userDiscordId: users.discordId,
      discordUserId: signups.discordUserId,
    })
    .from(signups)
    .leftJoin(users, eq(users.id, signups.userId))
    .where(eq(signups.eventId, eventId))
    .orderBy(signups.id);
}

/**
 * Catch-up: the not-yet-ended, not-cancelled events with a bound live
 * thread, plus (ROK-2272 S4b) those with a live registry post. Never an
 * event with neither — the catch-up must not create posts.
 */
export async function listUpcomingBoundEventIds(
  db: ForumDiscordDb,
  now: Date,
): Promise<number[]> {
  const bound = await listUpcomingHubEventIds(db, now);
  const planned = await listUpcomingPlanningEventIds(db, now);
  return [...new Set([...bound, ...planned])];
}

async function listUpcomingPlanningEventIds(
  db: ForumDiscordDb,
  now: Date,
): Promise<number[]> {
  const rows = await db
    .select({ eventId: events.id })
    .from(planningPosts)
    .innerJoin(events, livePlanningPost)
    .where(and(isNull(events.cancelledAt), notEnded(now)));
  return rows.map((r) => r.eventId);
}

async function listUpcomingHubEventIds(
  db: ForumDiscordDb,
  now: Date,
): Promise<number[]> {
  const rows = await db
    .select({ eventId: events.id })
    .from(threads)
    .innerJoin(events, eq(events.id, threads.eventId))
    .innerJoin(bindings, eq(bindings.guildId, threads.guildId))
    .where(
      and(
        isNull(threads.eventDetachedAt),
        isNull(events.cancelledAt),
        notEnded(now),
      ),
    );
  return rows.map((r) => r.eventId);
}
