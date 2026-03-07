/**
 * Event block building helpers for the composite game-time view.
 * Extracted from game-time-composite.helpers.ts for file size compliance (ROK-719).
 */
import type { EventBlockDescriptor, SignedUpEventRow } from './game-time.types';
import type { SignupsPreviewMap } from './game-time-signups.helpers';

/** Signups data shape for block building. */
type SignupsBlockData =
  | {
      preview: Array<{
        id: number;
        username: string;
        avatar: string | null;
        characters?: Array<{ gameId: number; avatarUrl: string | null }>;
      }>;
      count: number;
    }
  | undefined;

/** Compute day-of-week to hours mapping for a clamped event duration. */
function computeDayHours(
  clampedStart: Date,
  clampedEnd: Date,
  weekStart: Date,
  tzOffset: number,
): Map<number, number[]> {
  const dayHours = new Map<number, number[]>();
  const cursor = new Date(clampedStart);
  cursor.setUTCMinutes(0, 0, 0);
  if (cursor < clampedStart) cursor.setUTCHours(cursor.getUTCHours() + 1);
  while (cursor < clampedEnd) {
    const localMs = cursor.getTime() - tzOffset * 60 * 1000;
    const localDate = new Date(localMs);
    const dayDiff = Math.floor(
      (localMs - (weekStart.getTime() - tzOffset * 60 * 1000)) /
        (1000 * 60 * 60 * 24),
    );
    if (dayDiff >= 0 && dayDiff < 7) {
      const hours = dayHours.get(dayDiff) ?? [];
      hours.push(localDate.getUTCHours());
      dayHours.set(dayDiff, hours);
    }
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }
  return dayHours;
}

/** Extract game-related fields from an event row. */
function extractEventGameFields(event: SignedUpEventRow) {
  return {
    gameSlug: event.gameSlug ?? null,
    gameName: event.gameName ?? null,
    gameId: event.gameId ?? null,
    coverUrl: event.gameCoverUrl ?? null,
    description: event.description ?? null,
    creatorUsername: event.creatorUsername ?? null,
  };
}

/** Build a single event block descriptor. */
function buildSingleBlock(
  event: SignedUpEventRow,
  dayOfWeek: number,
  hours: number[],
  signupsData: SignupsBlockData,
): EventBlockDescriptor {
  hours.sort((a, b) => a - b);
  return {
    eventId: event.eventId,
    title: event.title,
    ...extractEventGameFields(event),
    signupId: event.signupId,
    confirmationStatus: event.confirmationStatus as
      | 'pending'
      | 'confirmed'
      | 'changed',
    dayOfWeek,
    startHour: hours[0],
    endHour: hours[hours.length - 1] + 1,
    signupsPreview: signupsData?.preview ?? [],
    signupCount: signupsData?.count ?? 0,
  };
}

/** Build event block descriptors for the weekly grid. */
export function buildEventBlocks(
  events: SignedUpEventRow[],
  weekStart: Date,
  weekEnd: Date,
  tzOffset: number,
  signupsMap: SignupsPreviewMap,
): EventBlockDescriptor[] {
  const eventBlocks: EventBlockDescriptor[] = [];
  for (const event of events) {
    const [eventStart, eventEnd] = event.duration;
    const clampedStart = eventStart < weekStart ? weekStart : eventStart;
    const clampedEnd = eventEnd > weekEnd ? weekEnd : eventEnd;
    const dayHours = computeDayHours(
      clampedStart,
      clampedEnd,
      weekStart,
      tzOffset,
    );
    const signupsData = signupsMap.get(event.eventId);
    for (const [dayOfWeek, hours] of dayHours) {
      if (hours.length === 0) continue;
      eventBlocks.push(buildSingleBlock(event, dayOfWeek, hours, signupsData));
    }
  }
  return eventBlocks;
}
