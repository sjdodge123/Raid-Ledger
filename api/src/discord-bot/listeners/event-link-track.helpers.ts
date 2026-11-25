/**
 * Persisting the `discord_event_messages` row for a link unfurl.
 *
 * Extracted from `EventLinkListener` (ROK-1622) to keep that file inside its
 * 300-line budget once the unfurl started deriving its own embed state.
 *
 * An unfurl CREATES a tracked message, so it is a first post in every sense
 * that matters here: whatever state it persists is the state the embed keeps
 * until something else re-renders it. Writing `POSTED` unconditionally is what
 * painted an imminent event cyan and then recorded that as the truth.
 */
import { count, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { EmbedEventData } from '../services/discord-embed.factory';
import { computeEmbedStateForData } from '../services/embed-state.helpers';

/**
 * Most `discord_event_messages` rows one event may have before an unfurl stops
 * being tracked (TDB L2847). Every tracked row is re-edited on each signup, so
 * link spam would otherwise grow the edit fan-out — and the shared bot's rate
 * limit spend — without bound. Past the cap the unfurl is still posted; it just
 * keeps the card it was rendered with. Existing rows (the event's own channel
 * card, forum card, shares) are never evicted.
 */
export const MAX_TRACKED_MESSAGES_PER_EVENT = 10;

/** Where one unfurl reply landed. */
export interface UnfurlTarget {
  guildId: string;
  channelId: string;
  messageId: string;
}

/**
 * Insert the tracking row for one unfurled event, with a derived state —
 * unless the event already has {@link MAX_TRACKED_MESSAGES_PER_EVENT} tracked
 * messages. The count-then-insert can overshoot only by the number of unfurls
 * racing for the same event, which keeps the set bounded.
 *
 * `onConflictDoNothing` keeps a repeated unfurl idempotent — the first row
 * wins, exactly as before.
 *
 * @param db - Drizzle handle.
 * @param target - Guild/channel/message the unfurl reply occupies.
 * @param eventId - Event the card is for.
 * @param data - The same projection the card was rendered from.
 * @returns `false` when the cap skipped tracking, `true` otherwise.
 */
export async function insertUnfurlTrackingRow(
  db: PostgresJsDatabase<typeof schema>,
  target: UnfurlTarget,
  eventId: number,
  data: EmbedEventData,
): Promise<boolean> {
  const tracked = await countTrackedMessages(db, eventId);
  if (tracked >= MAX_TRACKED_MESSAGES_PER_EVENT) return false;
  await db
    .insert(schema.discordEventMessages)
    .values({
      eventId,
      guildId: target.guildId,
      channelId: target.channelId,
      messageId: target.messageId,
      embedState: computeEmbedStateForData(data),
    })
    .onConflictDoNothing();
  return true;
}

/** Number of `discord_event_messages` rows already tracked for an event. */
async function countTrackedMessages(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.discordEventMessages)
    .where(eq(schema.discordEventMessages.eventId, eventId));
  return Number(row?.n ?? 0);
}
