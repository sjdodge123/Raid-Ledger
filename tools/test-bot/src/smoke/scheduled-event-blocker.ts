/**
 * Name the foreign Active Discord Scheduled Event that blocks a smoke test's
 * own scheduled event (TECH-DEBT-BACKLOG 2026-11-21).
 *
 * The SE smoke tests create an event with no game, so the API puts its
 * Scheduled Event on the default voice channel (`ChannelResolverService`
 * Tier 3), which `setup.ts` sets to `ctx.voiceChannels[0]`. While another
 * Scheduled Event sits Active on that channel the new one never appears, and
 * the wait used to time out after `timeoutMs` without naming the cause.
 *
 * Pure: no Discord client, no API. The caller passes the guild's events.
 */
import { GuildScheduledEventStatus } from 'discord.js';

/** The fields of a guild Scheduled Event this check reads. */
export interface ScheduledEventLike {
  id: string;
  name: string;
  status: GuildScheduledEventStatus;
  channelId: string | null;
}

/**
 * The first Active event on `channelId` that is not the test's own event
 * (matched by title substring, as the tests find their own), or null.
 */
export function pickBlockingEvent<T extends ScheduledEventLike>(
  events: Iterable<T>,
  channelId: string,
  ownTitle: string,
): T | null {
  for (const se of events) {
    if (se.name.includes(ownTitle)) continue;
    if (se.channelId !== channelId) continue;
    if (se.status === GuildScheduledEventStatus.Active) return se;
  }
  return null;
}

/** The failure message naming the blocker, its channel and the effect. */
export function describeBlockingEvent(
  blocker: ScheduledEventLike,
  channelId: string,
  ownTitle: string,
): string {
  return (
    `Scheduled Event for "${ownTitle}" cannot appear: foreign Scheduled Event ` +
    `${blocker.id} ("${blocker.name}") is Active on voice channel ${channelId}, ` +
    `which blocks new scheduled events on that channel. End or delete it, ` +
    `or point the smoke run at another voice channel.`
  );
}
