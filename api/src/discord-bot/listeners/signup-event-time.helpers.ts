import type * as schema from '../../drizzle/schema';
import { toDiscordTimestamp } from '../utils/time-parser';

/**
 * ROK-1422: an " — <t:…:F>" suffix carrying the event's start time, appended to
 * signup-confirmation replies so the attendee sees WHEN the event is right after
 * committing (the "Play again?" follow-up DM previously confirmed with no time).
 * Renders viewer-local via Discord's native timestamp markup. `duration` is a
 * `[start, end]` tuple; returns '' when the start is missing/invalid so a
 * malformed event never breaks the confirmation reply.
 */
export function signupTimeSuffix(
  event: Pick<typeof schema.events.$inferSelect, 'duration'>,
): string {
  const start = event.duration?.[0];
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) return '';
  return ` — ${toDiscordTimestamp(start, 'F')}`;
}
