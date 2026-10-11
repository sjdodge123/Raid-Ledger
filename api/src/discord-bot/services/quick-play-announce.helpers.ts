import { Logger } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { EMBED_STATES } from '../discord-bot.constants';
import type { AdHocNotificationDeps } from './ad-hoc-notification.helpers';

/**
 * ROK-1766 — Quick Play Announcements posting helpers.
 *
 * A `quick-play-announcements` binding names ONE text channel per game that
 * receives a per-event Quick Play card for every session of that game, from a
 * General Lobby room or a game-voice-monitor channel alike (spec §3.3).
 */

const logger = new Logger('QuickPlayAnnounce');

/** The Discord message an ad-hoc event's card lives in. */
export interface TrackedMessage {
  channelId: string;
  messageId: string;
}

/**
 * The QP channel a spawn under `bindingId` should post to, or null.
 *
 * Keys on the EFFECTIVE game (D9): `undefined` falls back to the binding's
 * stored game (same rule as `resolveNotificationChannel`, ROK-1394); an
 * explicit `null` (Untitled / Just Chatting) never posts.
 */
export async function resolveQuickPlayAnnounceChannel(
  deps: AdHocNotificationDeps,
  bindingId: string,
  effectiveGameId?: number | null,
): Promise<string | null> {
  const binding = await deps.channelBindingsService.getBindingById(bindingId);
  if (!binding?.guildId) return null;
  const gameId =
    effectiveGameId !== undefined ? effectiveGameId : binding.gameId;
  if (gameId == null) return null;
  return deps.channelBindingsService.getQuickPlayChannelForGame(
    binding.guildId,
    gameId,
  );
}

/**
 * D6 restart rehydration: the newest still-LIVE `discord_event_messages` row
 * for an event, so an in-memory Map lost to a deploy does not freeze the card.
 * A COMPLETED row is never returned — a late `queueUpdate` must not flip an
 * ended card back to LIVE. Failures are logged and read as "untracked".
 */
export async function loadTrackedMessage(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<TrackedMessage | null> {
  const t = schema.discordEventMessages;
  try {
    const row = await db.query.discordEventMessages.findFirst({
      columns: { channelId: true, messageId: true },
      where: and(eq(t.eventId, eventId), eq(t.embedState, EMBED_STATES.LIVE)),
      orderBy: [desc(t.createdAt)],
    });
    return row ?? null;
  } catch (err) {
    logger.warn(
      `Could not rehydrate tracked message for event ${eventId}: ${err}`,
    );
    return null;
  }
}

/** Mark an event's tracked rows COMPLETED so rehydration skips them. */
export async function markTrackedCompleted(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<void> {
  const t = schema.discordEventMessages;
  try {
    await db
      .update(t)
      .set({ embedState: EMBED_STATES.COMPLETED, updatedAt: new Date() })
      .where(eq(t.eventId, eventId));
  } catch (err) {
    logger.warn(`Could not mark event ${eventId} messages completed: ${err}`);
  }
}
