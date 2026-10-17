import type { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * App events raised when a channel binding is created, changed or removed.
 *
 * The voice listener and the lobby presence service each keep a 60 s
 * per-channel binding cache. Without this signal a new binding is ignored,
 * and a deleted one is still dispatched against, until the entry expires.
 */
export const CHANNEL_BINDING_EVENTS = {
  /** A binding on this channel was created, updated or deleted. */
  CHANGED: 'channel-binding.changed',
} as const;

/** Payload for {@link CHANNEL_BINDING_EVENTS.CHANGED}. */
export interface ChannelBindingChangedPayload {
  /** Discord channel whose cached bindings are now stale. */
  channelId: string;
}

/** Emit one {@link CHANNEL_BINDING_EVENTS.CHANGED} per distinct channel. */
export function announceBindingChange(
  emitter: EventEmitter2,
  channelIds: readonly string[],
): void {
  for (const channelId of new Set(channelIds)) {
    const payload: ChannelBindingChangedPayload = { channelId };
    emitter.emit(CHANNEL_BINDING_EVENTS.CHANGED, payload);
  }
}
