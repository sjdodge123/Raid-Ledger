/**
 * Slot-vacated notification relevance filter (ROK-919).
 *
 * Determines whether a roster departure warrants notifying the organizer.
 * Shared by: signup cancellation path (roster-notification-buffer) and
 * voice departure path (departure-grace processor).
 */
import { computeSlotCapacity } from '../events/signups-signup.helpers';
import type * as schema from '../drizzle/schema';

/** Minimal event shape needed for relevance checks. */
type EventLike = Pick<
  typeof schema.events.$inferSelect,
  'slotConfig' | 'maxAttendees'
>;

/**
 * Resolve the total non-bench capacity for an event.
 * Extracted so both relevance check and departure-grace can share it.
 */
export function resolveEventCapacity(event: EventLike): number | null {
  const slotConfig = event.slotConfig as Record<string, unknown> | null;
  if (slotConfig) return computeSlotCapacity(slotConfig);
  return event.maxAttendees ?? null;
}

/**
 * Check whether a slot departure is relevant enough to notify the organizer.
 *
 * Rules:
 * - MMO event + tank/healer departure -> always relevant
 * - MMO event + dps/flex/player departure -> never relevant
 * - Generic/no-config + event was at capacity before departure -> relevant
 * - Generic/no-config + event was NOT at capacity -> not relevant
 * - No capacity limit at all -> not relevant
 *
 * @param event - The event row (needs slotConfig + maxAttendees)
 * @param vacatedRole - The role the departing player held
 * @param activeSignupCount - Count of active signups AFTER departure
 */
export function isSlotVacatedRelevant(
  event: EventLike,
  vacatedRole: string,
  activeSignupCount: number,
): boolean {
  const slotConfig = event.slotConfig as Record<string, unknown> | null;
  if (slotConfig?.type === 'mmo') {
    return vacatedRole === 'tank' || vacatedRole === 'healer';
  }
  const capacity = resolveEventCapacity(event);
  if (capacity === null) return false;
  return activeSignupCount + 1 >= capacity;
}
