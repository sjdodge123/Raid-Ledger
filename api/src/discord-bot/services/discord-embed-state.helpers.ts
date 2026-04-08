/**
 * Embed state helpers for push content and color resolution (ROK-1014 extract).
 * Extracted from discord-embed.factory.ts to keep it within the 300-line limit.
 */
import {
  EMBED_COLORS,
  EMBED_STATES,
  type EmbedState,
} from '../discord-bot.constants';
import {
  buildEventPushContent,
  buildCancelledPushContent,
  buildCompletedPushContent,
} from '../utils/push-content';
import type { EmbedEventData } from './discord-embed.factory';

/** Select the correct push content format based on embed state. */
export function buildPushContentForState(
  event: EmbedEventData,
  state: EmbedState,
  timezone?: string | null,
): string {
  if (state === EMBED_STATES.CANCELLED) {
    return buildCancelledPushContent(event.title);
  }
  if (state === EMBED_STATES.COMPLETED) {
    return buildCompletedPushContent(event);
  }
  return buildEventPushContent(event, timezone);
}

/** Get the embed accent color for a given lifecycle state. */
export function getColorForState(state: EmbedState): number {
  switch (state) {
    case EMBED_STATES.POSTED:
    case EMBED_STATES.FILLING:
    case EMBED_STATES.FULL:
      return EMBED_COLORS.ANNOUNCEMENT;
    case EMBED_STATES.IMMINENT:
      return EMBED_COLORS.REMINDER;
    case EMBED_STATES.LIVE:
      return EMBED_COLORS.SIGNUP_CONFIRMATION;
    case EMBED_STATES.COMPLETED:
      return EMBED_COLORS.SYSTEM;
    case EMBED_STATES.CANCELLED:
      return EMBED_COLORS.ERROR;
    default:
      return EMBED_COLORS.ANNOUNCEMENT;
  }
}
