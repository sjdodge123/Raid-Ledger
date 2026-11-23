/**
 * ROK-2208 §5.7 — the reads behind an event thread's lazy Discord post: the
 * event fields its title shows, the moment an event thread's sync was born
 * (for the MAJOR-2 stale check), and the posts a retitle renames.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { forumStarterRowsOnly } from '../../../discord-bot/services/event-message-rows.helpers';
import * as schema from '../../../drizzle/schema';
import type { ForumLink } from './hub-forum-discord-links.queries';
import type { EventThreadWriteState } from './hub-forum-discord-event-outbound';
import { subjectOf } from './hub-forum-discord-subject';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

const threads = schema.hubForumThreads;
const events = schema.events;
const links = schema.hubForumDiscordLinks;

/** An event thread and the event fields its Discord post shows. */
export interface EventPostSource extends EventThreadWriteState {
  eventId: number;
  eventTitle: string;
  start: Date;
  /** The 2226 root text. */
  body: string;
}

/** The event thread `threadId` with its event; null for a plain thread. */
export async function findEventPostSource(
  db: ForumDiscordDb,
  threadId: number,
): Promise<EventPostSource | null> {
  const [row] = await db
    .select({
      eventId: events.id,
      eventTitle: events.title,
      duration: events.duration,
      body: threads.body,
      writeClosesAt: threads.writeClosesAt,
      eventDetachedAt: threads.eventDetachedAt,
    })
    .from(threads)
    .innerJoin(events, eq(events.id, threads.eventId))
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!row) return null;
  const { duration, ...rest } = row;
  return { ...rest, start: duration[0] };
}

/** An event's title and scheduled start; null once the event is gone. */
export async function findEventHeading(
  db: ForumDiscordDb,
  eventId: number,
): Promise<{ title: string; start: Date } | null> {
  const [row] = await db
    .select({ title: events.title, duration: events.duration })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  return row ? { title: row.title, start: row.duration[0] } : null;
}

/**
 * When the thread's sync began, for the stale-binding check. A plain thread:
 * its creation (R8). A subject (event / poll / lineup, ROK-2272 S8) thread is
 * created with its subject but posted lazily (§5.7 item 1), so its sync
 * begins with its post link — `now` when it has none yet. Null once the
 * thread is gone.
 */
export async function syncBornAt(
  db: ForumDiscordDb,
  threadId: number,
  now: Date,
): Promise<Date | null> {
  const [row] = await db
    .select({
      createdAt: threads.createdAt,
      eventId: threads.eventId,
      matchId: threads.matchId,
      lineupId: threads.lineupId,
      linkedAt: links.createdAt,
    })
    .from(threads)
    .leftJoin(
      links,
      and(eq(links.threadId, threads.id), eq(links.kind, 'thread')),
    )
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!row) return null;
  if (subjectOf(row) === null) return row.createdAt;
  return row.linkedAt ?? now;
}

/** The post links of the event's live (attached) thread. */
export async function liveEventPostLinks(
  db: ForumDiscordDb,
  eventId: number,
): Promise<ForumLink[]> {
  const rows = await db
    .select({ link: links })
    .from(links)
    .innerJoin(threads, eq(threads.id, links.threadId))
    .where(
      and(
        eq(threads.eventId, eventId),
        isNull(threads.eventDetachedAt),
        eq(links.kind, 'thread'),
      ),
    );
  return rows.map((r) => r.link);
}

/**
 * ROK-2292 D6 — the post `discordThreadId` opens with a tracked signup card
 * (a forum starter row): its starter is the card, never the text body.
 */
export async function hasForumStarterCard(
  db: ForumDiscordDb,
  discordThreadId: string,
): Promise<boolean> {
  const t = schema.discordEventMessages;
  const [row] = await db
    .select({ id: t.id })
    .from(t)
    .where(and(forumStarterRowsOnly(), eq(t.channelId, discordThreadId)))
    .limit(1);
  return row !== undefined;
}
