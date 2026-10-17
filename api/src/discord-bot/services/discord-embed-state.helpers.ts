/**
 * Embed state helpers for push content (ROK-1014 extract).
 * Extracted from discord-embed.factory.ts to keep it within the 300-line limit.
 *
 * ROK-1460: colour resolution moved out — a lifecycle state maps onto a chrome
 * state (`lifecycleToChromeState`) and the chrome owns the palette.
 */
import { EMBED_STATES, type EmbedState } from '../discord-bot.constants';
import {
  buildEventPushContent,
  buildCancelledPushContent,
  buildCompletedPushContent,
  buildReschedulingPushContent,
} from '../utils/push-content';
import type { EmbedEventData } from './discord-embed.factory';

/**
 * Select the correct push content format based on embed state.
 *
 * @param event - The event the push line describes.
 * @param state - Lifecycle state being rendered.
 * @param timezone - Community timezone for the date-carrying variants.
 * @returns A plaintext push line; never empty.
 */
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
  if (state === EMBED_STATES.RESCHEDULING) {
    return buildReschedulingPushContent(event.title);
  }
  return buildEventPushContent(event, timezone);
}
