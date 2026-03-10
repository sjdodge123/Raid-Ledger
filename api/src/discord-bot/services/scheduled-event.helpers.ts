import { perfLog } from '../../common/perf-logger';

/** Discord API error code for "Unknown Scheduled Event" (manually deleted). */
export const UNKNOWN_SCHEDULED_EVENT = 10070;

/** Maximum description length for Discord Scheduled Events. */
export const MAX_DESCRIPTION_LENGTH = 1000;

/** Timeout (ms) for individual Discord API calls (ROK-685). */
export const DISCORD_API_TIMEOUT_MS = 5_000;

/**
 * Execute a Discord API call with [PERF] DISCORD instrumentation
 * and a timeout guard (ROK-685).
 */
export async function timedDiscordCall<T>(
  operation: string,
  fn: () => Promise<T>,
  meta?: Record<string, string | number | null | undefined>,
): Promise<T> {
  const start = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Discord API timeout: ${operation} exceeded ${DISCORD_API_TIMEOUT_MS}ms`,
              ),
            ),
          DISCORD_API_TIMEOUT_MS,
        );
      }),
    ]);
    perfLog('DISCORD', operation, performance.now() - start, meta);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export interface ScheduledEventData {
  title: string;
  description?: string | null;
  startTime: string;
  endTime: string;
  signupCount: number;
  maxAttendees?: number | null;
  game?: { name: string } | null;
}

/**
 * Build the description string for a Discord Scheduled Event.
 */
export function buildDescriptionText(
  eventId: number,
  eventData: ScheduledEventData,
  clientUrl: string | null,
): string {
  const link = clientUrl
    ? `\n\nView event: ${clientUrl}/events/${eventId}`
    : '';

  const gameName = eventData.game?.name ?? 'Event';
  const attendeeStr = eventData.maxAttendees
    ? `${eventData.signupCount}/${eventData.maxAttendees}`
    : `${eventData.signupCount}`;

  const header = `${gameName} — ${attendeeStr} signed up`;
  const eventDesc = eventData.description ?? '';

  const full = eventDesc
    ? `${header}\n${eventDesc}${link}`
    : `${header}${link}`;

  if (full.length <= MAX_DESCRIPTION_LENGTH) return full;

  return truncateDescription(header, eventDesc, link);
}

/** Format an API error message for logging. */
export function formatApiError(
  op: string,
  eventId: number,
  error: unknown,
): string {
  const msg = error instanceof Error ? error.message : 'Unknown error';
  return `Failed to ${op} scheduled event for event ${eventId}: ${msg}`;
}

/** Check if scheduled event creation should be skipped (ROK-755). Returns reason or null. */
export function getCreateSkipReason(
  eventId: number,
  startTime: string,
  isAdHoc?: boolean,
  isConnected?: boolean,
): string | null {
  if (isAdHoc)
    return `Skipping scheduled event for event ${eventId}: ad-hoc event`;
  if (!isConnected)
    return `Skipping scheduled event for event ${eventId}: bot not connected`;
  if (new Date(startTime).getTime() <= Date.now())
    return `Skipping scheduled event for event ${eventId}: start time in the past`;
  return null;
}

/** Truncate event description to fit within the limit. */
function truncateDescription(
  header: string,
  eventDesc: string,
  link: string,
): string {
  const headerAndLink = `${header}${link}`;
  if (headerAndLink.length >= MAX_DESCRIPTION_LENGTH) {
    return headerAndLink.slice(0, MAX_DESCRIPTION_LENGTH - 3) + '...';
  }

  const available =
    MAX_DESCRIPTION_LENGTH - header.length - 1 - link.length - 3;
  const truncated = available > 0 ? eventDesc.slice(0, available) + '...' : '';
  return truncated ? `${header}\n${truncated}${link}` : `${header}${link}`;
}
