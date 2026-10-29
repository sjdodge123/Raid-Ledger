/**
 * ROK-1933 Part 4 — app events announcing a hub's Discord channel binding
 * changed. Emitted by `GuildDiscordService` (manual set/clear) and
 * `HubChannelLinkService` (lifecycle auto-link) so the binding code never
 * imports the welcome-embed module; `HubWelcomeService` listens.
 */
import { Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';

export const HUB_CHANNEL_EVENTS = {
  /** Payload: {@link HubChannelLinkedEvent}. Also fires on a same-channel re-link. */
  LINKED: 'hub.channel.linked',
  /** Payload: {@link HubChannelClearedEvent}. */
  CLEARED: 'hub.channel.cleared',
} as const;

/** A hub's channel was set (or re-set to the same channel). */
export interface HubChannelLinkedEvent {
  guildId: number;
  channelId: string;
  /** The channel bound before this write; null when there was none. */
  previousChannelId: string | null;
}

/** A hub's channel was unbound. */
export interface HubChannelClearedEvent {
  guildId: number;
  /** The channel bound before the clear; null when there was none. */
  previousChannelId: string | null;
}

const logger = new Logger('HubChannelEvents');

/**
 * Fire-and-forget emit: a throwing synchronous listener is logged, never
 * rethrown, so a Discord failure can never fail the bind that announced it.
 *
 * @param events - The app event bus (absent in bare unit construction).
 * @param name - One of {@link HUB_CHANNEL_EVENTS}.
 * @param payload - The matching event payload.
 */
export function emitHubChannelEvent(
  events: EventEmitter2 | undefined,
  name: (typeof HUB_CHANNEL_EVENTS)[keyof typeof HUB_CHANNEL_EVENTS],
  payload: HubChannelLinkedEvent | HubChannelClearedEvent,
): void {
  if (!events) return;
  try {
    events.emit(name, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      `${name} listener failed for guild ${payload.guildId}: ${message}`,
    );
  }
}
