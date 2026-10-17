import { EMBED_STATES, type EmbedState } from '../discord-bot.constants';
import type { EmbedEventData } from './discord-embed.factory';

/** Two hours in milliseconds — threshold for IMMINENT state. */
export const IMMINENT_THRESHOLD_MS = 2 * 60 * 60 * 1000;

/** Overrides for callers holding the authoritative DB row. */
export interface EmbedStateOptions {
  /** The event row's own start instant. Defaults to `data.startTime`. */
  startTime?: Date | null;
  /** The event row's end instant, `extendedUntil` included. Defaults to `data.endTime`. */
  endTime?: Date | null;
  /** Injectable clock, for deterministic tests. Defaults to `Date.now()`. */
  now?: number;
}

/**
 * Derive the lifecycle state of an event embed from its own projection.
 *
 * ROK-1622: the initial post used to hardcode `POSTED`, so an event created
 * inside the 2h window went out cyan and depended on a later embed-sync pass
 * to correct itself. Every writer now derives the state from the same rules,
 * which makes the first write already correct.
 *
 * Transition order (timing beats capacity):
 * - past its end time -> COMPLETED
 * - past its start time -> LIVE
 * - within 2 hours of starting -> IMMINENT
 * - otherwise FULL / FILLING / POSTED by roster fill
 *
 * @param data - The event projection the embed is rendered from.
 * @param options - Authoritative window overrides and an injectable clock.
 * @returns The lifecycle state the embed should be posted or edited into.
 */
export function computeEmbedStateForData(
  data: EmbedEventData,
  options?: EmbedStateOptions,
): EmbedState {
  const now = options?.now ?? Date.now();
  const startTime = (options?.startTime ?? new Date(data.startTime)).getTime();
  const endTime = (options?.endTime ?? new Date(data.endTime)).getTime();

  if (now >= endTime) return EMBED_STATES.COMPLETED;
  if (now >= startTime) return EMBED_STATES.LIVE;
  if (startTime - now <= IMMINENT_THRESHOLD_MS) return EMBED_STATES.IMMINENT;

  return computeCapacityState(data);
}

/** Compute capacity-based state (FULL, FILLING, or POSTED). */
function computeCapacityState(data: EmbedEventData): EmbedState {
  if (data.maxAttendees && data.signupCount >= data.maxAttendees) {
    return EMBED_STATES.FULL;
  }
  const totalSlots = getTotalSlotsFromConfig(data.slotConfig);
  if (totalSlots > 0 && data.signupCount >= totalSlots) {
    return EMBED_STATES.FULL;
  }
  return data.signupCount > 0 ? EMBED_STATES.FILLING : EMBED_STATES.POSTED;
}

/** Compute total player slots from slotConfig. Returns 0 if no config. */
function getTotalSlotsFromConfig(
  slotConfig: EmbedEventData['slotConfig'],
): number {
  if (!slotConfig) return 0;
  if (slotConfig.type === 'mmo') {
    return (
      (slotConfig.tank ?? 0) +
      (slotConfig.healer ?? 0) +
      (slotConfig.dps ?? 0) +
      (slotConfig.flex ?? 0)
    );
  }
  return slotConfig.player ?? 0;
}
