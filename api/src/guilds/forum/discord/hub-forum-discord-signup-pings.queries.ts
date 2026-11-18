/**
 * ROK-2260 — the reads behind signup pings: the event's live thread in a hub
 * bound to a Discord forum, the event's signups (with each signer's Discord
 * id), and the upcoming bound events the one-time deploy catch-up flushes.
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

/** The event's live thread, in a hub bound to a Discord forum. */
export interface PingThreadRef {
  guildId: number;
  threadId: number;
  /** The event's scheduled end (the pinged set expires after it). */
  endsAt: Date;
}

const notEnded = (now: Date) =>
  sql`upper(${events.duration}) > ${now.toISOString()}::timestamp`;

/** The event's attached thread when its hub is bound; null otherwise. */
export async function findBoundEventThread(
  db: ForumDiscordDb,
  eventId: number,
): Promise<PingThreadRef | null> {
  const [row] = await db
    .select({
      guildId: threads.guildId,
      threadId: threads.id,
      duration: events.duration,
    })
    .from(threads)
    .innerJoin(events, eq(events.id, threads.eventId))
    .innerJoin(bindings, eq(bindings.guildId, threads.guildId))
    .where(and(eq(threads.eventId, eventId), isNull(threads.eventDetachedAt)))
    .limit(1);
  if (!row) return null;
  return {
    guildId: row.guildId,
    threadId: row.threadId,
    endsAt: row.duration[1],
  };
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

/** Catch-up: the not-yet-ended, not-cancelled events with a bound live thread. */
export async function listUpcomingBoundEventIds(
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
