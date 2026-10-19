import { Logger } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { EMBED_STATES } from '../discord-bot.constants';
import {
  type AdHocNotificationDeps,
  isGeneralLobbyBinding,
  resolveNotificationChannel,
} from './ad-hoc-notification.helpers';

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
 * The channels this service itself could have posted `eventId`'s spawn card
 * to: the QP channel for the event's game, plus — for a monitor, never a
 * lobby (D7) — its notification channel. Anything else holding a LIVE row for
 * the event (a link unfurl, a share) was not posted by us.
 *
 * ROK-1851: the card was posted under the event's CREATING binding (the
 * stored `channelBindingId`, never rewritten on reuse), so the lookup keys on
 * it — not on `bindingId`, the binding that happened to enqueue the update. A
 * lobby that reuses a monitor-born event must still find the card in the
 * monitor's fallback channel after a restart. A server-born event (null
 * binding) falls back to `bindingId`.
 */
async function spawnChannelsFor(
  deps: AdHocNotificationDeps,
  eventId: number,
  enqueuingBindingId: string,
): Promise<string[]> {
  const event = await deps.db.query.events.findFirst({
    columns: { gameId: true, channelBindingId: true },
    where: eq(schema.events.id, eventId),
  });
  const gameId = event ? event.gameId : undefined;
  const bindingId = event?.channelBindingId ?? enqueuingBindingId;
  const qp = await resolveQuickPlayAnnounceChannel(deps, bindingId, gameId);
  const channels = qp ? [qp] : [];
  if (await isGeneralLobbyBinding(deps, bindingId)) return channels;
  const fallback = await resolveNotificationChannel(deps, bindingId, gameId);
  if (fallback) channels.push(fallback);
  return channels;
}

/**
 * D6 restart rehydration: the spawn card an in-memory Map lost to a deploy,
 * so the card does not freeze. Only rows in a channel this service could have
 * posted to (`spawnChannelsFor`) qualify — a lobby event with no QP binding
 * has none, so its unfurl/share rows are never adopted (AC8). `null` is a
 * DEFINITE miss; a DB / binding lookup failure THROWS so the caller does not
 * cache a transient error as "untracked" (ROK-1766 fix round 2, m1).
 */
export async function rehydrateSpawnMessage(
  deps: AdHocNotificationDeps,
  eventId: number,
  bindingId: string,
): Promise<TrackedMessage | null> {
  const channels = await spawnChannelsFor(deps, eventId, bindingId);
  if (channels.length === 0) return null;
  return loadTrackedMessage(deps.db, eventId, channels);
}

/**
 * The OLDEST still-LIVE `discord_event_messages` row for an event within
 * `channels`. Oldest, not newest: the spawn card is inserted at spawn, while a
 * link unfurl (`event-link-track.helpers.ts`) or a share of the running
 * session inserts a later row whose derived state is also LIVE.
 * A COMPLETED row is never returned — a late `queueUpdate` must not flip an
 * ended card back to LIVE. A query failure throws (see `rehydrateSpawnMessage`).
 */
export async function loadTrackedMessage(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  channels: string[],
): Promise<TrackedMessage | null> {
  const t = schema.discordEventMessages;
  const row = await db.query.discordEventMessages.findFirst({
    columns: { channelId: true, messageId: true },
    where: and(
      eq(t.eventId, eventId),
      eq(t.embedState, EMBED_STATES.LIVE),
      inArray(t.channelId, channels),
    ),
    orderBy: [asc(t.createdAt)],
  });
  return row ?? null;
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
