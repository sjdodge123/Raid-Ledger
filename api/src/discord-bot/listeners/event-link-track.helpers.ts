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
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { EmbedEventData } from '../services/discord-embed.factory';
import { computeEmbedStateForData } from '../services/embed-state.helpers';

/** Where one unfurl reply landed. */
export interface UnfurlTarget {
  guildId: string;
  channelId: string;
  messageId: string;
}

/**
 * Insert the tracking row for one unfurled event, with a derived state.
 *
 * `onConflictDoNothing` keeps a repeated unfurl idempotent — the first row
 * wins, exactly as before.
 *
 * @param db - Drizzle handle.
 * @param target - Guild/channel/message the unfurl reply occupies.
 * @param eventId - Event the card is for.
 * @param data - The same projection the card was rendered from.
 */
export async function insertUnfurlTrackingRow(
  db: PostgresJsDatabase<typeof schema>,
  target: UnfurlTarget,
  eventId: number,
  data: EmbedEventData,
): Promise<void> {
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
}
