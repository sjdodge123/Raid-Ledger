/**
 * Enriches an EventResponseDto with conflict data for the authenticated user (ROK-1031).
 * Called from the controller layer to attach myConflicts when a userId is available.
 */
import type {
  EventResponseDto,
  ConflictingEventDto,
} from '@raid-ledger/contract';
import type {
  FindConflictsParams,
  ConflictingEvent,
} from './event-conflict.helpers';

/** Function signature matching findConflictingEvents. */
type ConflictFinder = (
  params: FindConflictsParams,
) => Promise<ConflictingEvent[]>;

/** Maps a raw conflict row to the API response shape. */
function mapConflict(c: ConflictingEvent): ConflictingEventDto {
  return {
    id: c.id,
    title: c.title,
    startTime: c.duration[0].toISOString(),
    endTime: c.duration[1].toISOString(),
  };
}

/**
 * Enriches an event response with myConflicts for the authenticated user.
 * Returns the event unchanged when userId is null or if the finder throws.
 * @param event - The base event response
 * @param userId - Authenticated user ID, or null
 * @param finder - Conflict detection function (injected for testability)
 */
export async function enrichEventWithConflicts(
  event: EventResponseDto,
  userId: number | null,
  finder: ConflictFinder,
): Promise<EventResponseDto> {
  if (userId === null) return event;

  try {
    const conflicts = await finder({
      userId,
      startTime: new Date(event.startTime),
      endTime: new Date(event.endTime),
      excludeEventId: event.id,
    });
    return { ...event, myConflicts: conflicts.map(mapConflict) };
  } catch {
    return event;
  }
}
