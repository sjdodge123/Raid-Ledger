/**
 * Name the foreign Active Discord Scheduled Event that blocks a smoke test's
 * own scheduled event from going Active (TECH-DEBT-BACKLOG 2026-11-21).
 *
 * Discord never blocks CREATING a Scheduled Event on a busy voice channel. It
 * refuses the Scheduled -> Active edit while another event is Active on the
 * same channel (`api/src/discord-bot/services/scheduled-event.channel-busy.ts`),
 * which surfaces as `code=50035 message=Voice channel busy (another SE Active)`
 * in the completion pass (ROK-944) or as an SE that never reaches Active
 * (ROK-2201). The tests call this only on those failure paths, to say WHICH
 * event is in the way; it never decides a pass or a fail on its own.
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

/** A foreign Active event and the voice channel it shares with ours. */
export interface ChannelBlocker<T extends ScheduledEventLike> {
  blocker: T;
  channelId: string;
}

/**
 * The first Active event on `channelId` other than the test's own event
 * (excluded by its Scheduled Event id), or null.
 */
export function pickBlockingEvent<T extends ScheduledEventLike>(
  events: Iterable<T>,
  channelId: string,
  ownSeId: string,
): T | null {
  for (const se of events) {
    if (se.id === ownSeId) continue;
    if (se.channelId !== channelId) continue;
    if (se.status === GuildScheduledEventStatus.Active) return se;
  }
  return null;
}

/**
 * The foreign Active event on the channel of the test's own event, taking
 * that channel from `events` (the own event, matched by id). Null when the
 * own event is absent, has no channel, or nothing else is Active there.
 */
export function findOwnChannelBlocker<T extends ScheduledEventLike>(
  events: Iterable<T>,
  ownSeId: string,
): ChannelBlocker<T> | null {
  const all = [...events];
  const channelId = all.find((se) => se.id === ownSeId)?.channelId;
  if (!channelId) return null;
  const blocker = pickBlockingEvent(all, channelId, ownSeId);
  return blocker ? { blocker, channelId } : null;
}

/** The text appended to a failure: the blocker, its channel, the fix. */
export function describeBlockingEvent(
  blocker: ScheduledEventLike,
  channelId: string,
): string {
  return (
    `foreign Scheduled Event ${blocker.id} ("${blocker.name}") is Active on ` +
    `voice channel ${channelId}, which blocks activation (Scheduled -> Active) ` +
    `of other scheduled events on that channel. End or delete it, then re-run.`
  );
}
