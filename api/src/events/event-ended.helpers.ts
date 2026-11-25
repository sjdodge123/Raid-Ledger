/**
 * The one "is this event over?" rule shared by every signup path
 * (`assertEventAcceptingSignups`) and the reschedule DM's Confirm/Tentative.
 */
import type * as schema from '../drizzle/schema';

/** The refusal every signup path gives once an event is over. */
export const EVENT_ENDED_SIGNUP_MESSAGE =
  'This event has ended and is no longer accepting signups.';

/**
 * The one "is this event over?" rule for signups: an ended ad-hoc session,
 * or an effective end (`extendedUntil`, else the scheduled end) in the past.
 */
export function isEventOver(
  event: Pick<
    typeof schema.events.$inferSelect,
    'duration' | 'extendedUntil' | 'adHocStatus'
  >,
  now: Date = new Date(),
): boolean {
  if (event.adHocStatus === 'ended') return true;
  const effectiveEnd = event.extendedUntil ?? event.duration?.[1];
  return !!effectiveEnd && effectiveEnd < now;
}
