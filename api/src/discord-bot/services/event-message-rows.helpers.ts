/**
 * ROK-2292 — two kinds of `discord_event_messages` row share the table:
 *
 * - **announcement** rows: the signup embed posted in a text channel (and its
 *   forward/unfurl/share copies). A text-channel message id never equals its
 *   channel id.
 * - **forum starter** rows: the first message of an event's Discord forum post.
 *   Discord gives a post's starter message the same id as the thread, so the
 *   row is recognised by `channel_id = message_id` (no `kind` column, no
 *   migration — spec D1).
 *
 * Every reader that picks ONE row (`.limit(1)`), the bump paths and the delete
 * path read announcement rows only; the embed updater edits both kinds.
 */
import { and, eq, ne, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

/** The two columns that tell a forum starter row from an announcement row. */
export interface EventMessageRowIds {
  channelId: string;
  messageId: string;
}

/** True when the row tracks a forum post's starter message. */
export function isForumStarterRow(row: EventMessageRowIds): boolean {
  return row.channelId === row.messageId;
}

/** SQL predicate: announcement-channel rows only (not forum starters). */
export function announcementRowsOnly(): SQL {
  const t = schema.discordEventMessages;
  return ne(t.channelId, t.messageId);
}

/** SQL predicate: forum post starter rows only. */
export function forumStarterRowsOnly(): SQL {
  const t = schema.discordEventMessages;
  return eq(t.channelId, t.messageId);
}

/** Where an event's announcement embed lives in Discord. */
export interface AnnouncementMessageRef {
  guildId: string;
  channelId: string;
  messageId: string;
}

/**
 * The event's announcement-channel embed message (any guild), or null. Never
 * a forum starter: a starter row must not stand in for "the embed is posted"
 * nor for the "View in Discord" link (ROK-2292 R1).
 */
export async function findAnnouncementMessage(
  db: Pick<PostgresJsDatabase<typeof schema>, 'select'>,
  eventId: number,
): Promise<AnnouncementMessageRef | null> {
  const t = schema.discordEventMessages;
  const [row] = await db
    .select({
      guildId: t.guildId,
      channelId: t.channelId,
      messageId: t.messageId,
    })
    .from(t)
    .where(and(eq(t.eventId, eventId), announcementRowsOnly()))
    .limit(1);
  return row ?? null;
}
